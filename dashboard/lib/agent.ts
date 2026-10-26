// Server-only: runs an agent action end to end with the agent key from .env.
//   build (fee payer as source) → simulate → sign the agent's auth entry →
//   re-simulate with the signed entry (covenant runs here; a refusal is decoded
//   before anything is submitted) → assemble → fee payer signs → submit.
import { Keypair } from "@stellar/stellar-sdk";
import { KovanError, keypairTransactionSigner } from "@kovan/sdk";
export { onlyAgentEntry } from "@kovan/sdk";
import { kovanClient } from "./kovan";
import { agentPubkeyHex } from "./authpayload";
import { simulateRead } from "./contracts";
import { ids } from "./stellar";
import { xdr } from "@stellar/stellar-sdk";
import type { SubmitResult } from "./submit";
import { defaultKeystore } from "./keystore";

export type AgentAction = "draw" | "pay" | "return";
export type AgentRequest = { agent: string; amount: string; to?: string; pool?: string };

const FEE_PAYER_LABEL = "fee-payer";

/**
 * The account that pays XLM fees for agent transactions: FEE_PAYER_SECRET if
 * set, otherwise a key generated into the local keystore and funded once by
 * Friendbot (testnet only).
 */
export async function feePayerKeypair(): Promise<Keypair> {
  const fromEnv = process.env.FEE_PAYER_SECRET?.trim();
  if (fromEnv) return Keypair.fromSecret(env("FEE_PAYER_SECRET"));
  const ks = defaultKeystore();
  const existing = ks.secretForLabel(FEE_PAYER_LABEL);
  if (existing) return Keypair.fromSecret(existing);
  const info = ks.getOrCreate(FEE_PAYER_LABEL);
  const r = await fetch(`https://friendbot.stellar.org/?addr=${info.publicKey}`);
  if (!r.ok) throw new Error(`Friendbot could not fund the fee payer ${info.publicKey.slice(0, 8)}…: ${r.status}`);
  return Keypair.fromSecret(ks.secretForLabel(FEE_PAYER_LABEL)!);
}

export function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set in dashboard/.env.local`);
  if (!/^S[A-Z2-7]{55}$/.test(v)) throw new Error(`${name} is not a Stellar secret key (S…)`);
  return v;
}

/** Reads the account's rule-0 External signer: (verifier, pubkey hex). */
export async function onchainSigner(agent: string): Promise<{ verifier: string; pubkeyHex: string }> {
  const rule = await simulateRead<{ signers: unknown[] }>(agent, "get_context_rule", [xdr.ScVal.scvU32(0)]);
  const signer = rule.signers?.[0] as [string, string, Buffer] | undefined;
  if (!signer || !Buffer.isBuffer(signer[2])) throw new Error("agent account has no External signer on rule 0");
  return { verifier: String(signer[1]), pubkeyHex: signer[2].toString("hex") };
}

/**
 * Finds the secret for this agent: the local keystore (keys generated from the
 * console) first, then AGENT_SECRET from .env.local. Verifies it matches the
 * account's on-chain signer and that the verifier is the one we expect.
 */
export async function resolveAgentSecret(agent: string, verifier?: string): Promise<string> {
  const chain = await onchainSigner(agent);
  if (verifier && chain.verifier !== verifier) {
    throw new Error(`agent account uses verifier ${chain.verifier.slice(0, 8)}…, console is configured with ${verifier.slice(0, 8)}…`);
  }
  const stored = defaultKeystore().secretForPubkeyHex(chain.pubkeyHex);
  if (stored) return stored;
  const envSecret = process.env.AGENT_SECRET?.trim();
  if (envSecret) {
    if (!/^S[A-Z2-7]{55}$/.test(envSecret)) throw new Error("AGENT_SECRET is not a Stellar secret key (S…)");
    const mine = agentPubkeyHex(envSecret);
    if (mine === chain.pubkeyHex) return envSecret;
    throw new Error(`agent key does not match account: on-chain signer ${chain.pubkeyHex.slice(0, 8)}…, AGENT_SECRET derives ${mine.slice(0, 8)}…`);
  }
  throw new Error(`no key for agent ${agent.slice(0, 8)}…: generate agents from the console or set AGENT_SECRET in dashboard/.env.local`);
}

/** Kept for callers that already hold a secret. */
export async function assertAgentKeyMatches(agent: string, secret: string, verifier?: string): Promise<void> {
  const chain = await onchainSigner(agent);
  if (verifier && chain.verifier !== verifier) throw new Error(`agent account uses verifier ${chain.verifier.slice(0, 8)}…, console is configured with ${verifier.slice(0, 8)}…`);
  if (agentPubkeyHex(secret) !== chain.pubkeyHex) throw new Error(`agent key does not match account: on-chain signer ${chain.pubkeyHex.slice(0, 8)}…`);
}

export type AgentRunResult = SubmitResult & { stage: "guard" | "simulate" | "submit" };

export async function runAgentAction(action: AgentAction, r: AgentRequest): Promise<AgentRunResult> {
  const feePayer = await feePayerKeypair();
  const { verifier, pool } = ids(r.pool);
  const key = Keypair.fromSecret(await resolveAgentSecret(r.agent, verifier));
  const client = kovanClient(r.pool);
  try {
    const prepared = await client.pool(pool).prepareAgent(action, r, {
      source: feePayer.publicKey(),
      signer: { publicKey: key.rawPublicKey().toString("hex"), sign: (digest) => key.sign(Buffer.from(digest)) },
    });
    return { ...await client.signAndSend(prepared, keypairTransactionSigner(feePayer)), stage: "submit" };
  } catch (e) {
    if (e instanceof KovanError) return { hash: "", status: "ERROR", stage: e.stage, error: e.message, raw: e.raw };
    throw e;
  }
}
