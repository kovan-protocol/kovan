// Server-only: runs an agent action end to end with the agent key from .env.
//   build (fee payer as source) → simulate → sign the agent's auth entry →
//   re-simulate with the signed entry (covenant runs here; a refusal is decoded
//   before anything is submitted) → assemble → fee payer signs → submit.
import { Address, Contract, Keypair, Operation, rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { agentPubkeyHex, signAgentEntry } from "./authpayload";
import { simulateRead } from "./contracts";
import { explainError } from "./errors";
import { addrVal, i128Val } from "./scval";
import { assertKovanPool, ids, NETWORK_PASSPHRASE, rpcServer, withRetry } from "./stellar";
import { submitSigned, type SubmitResult } from "./submit";
import { defaultKeystore } from "./keystore";

export type AgentAction = "draw" | "pay" | "return";
export type AgentRequest = { agent: string; amount: string; to?: string; pool?: string };

/** Auth entries expire this many ledgers after the latest one (~5 min). */
const EXPIRY_LEDGERS = 60;

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

/**
 * The only auth entries we sign are the agent account's own (legacy Address
 * credentials). Anything else would be satisfied by the fee payer's envelope
 * signature, so it is refused outright.
 */
export function onlyAgentEntry(
  e: xdr.SorobanAuthorizationEntry,
  agent: string,
  sign: (entry: xdr.SorobanAuthorizationEntry) => xdr.SorobanAuthorizationEntry,
): xdr.SorobanAuthorizationEntry {
  const kind = e.credentials().switch();
  if (kind !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    throw new Error(`refusing to sign: simulation requires ${kind.name} credentials, which the fee payer would satisfy`);
  }
  const who = Address.fromScAddress(e.credentials().address().address()).toString();
  if (who !== agent) throw new Error(`refusing to sign: simulation requires authorization from ${who.slice(0, 8)}…, not the agent`);
  return sign(e);
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

function buildOp(action: AgentAction, r: AgentRequest): xdr.Operation {
  const { pool, usdc } = ids(r.pool);
  switch (action) {
    case "draw":
      return new Contract(pool).call("draw", addrVal(r.agent), i128Val(r.amount));
    case "pay":
      if (!r.to) throw new Error("`to` is required for pay");
      return new Contract(usdc).call("transfer", addrVal(r.agent), addrVal(r.to), i128Val(r.amount));
    case "return":
      return new Contract(pool).call("return_funds", addrVal(r.agent), addrVal(r.agent), i128Val(r.amount));
    default:
      throw new Error(`unknown agent action ${String(action)}`);
  }
}

export type AgentRunResult = SubmitResult & { stage: "guard" | "simulate" | "submit" };

export async function runAgentAction(action: AgentAction, r: AgentRequest): Promise<AgentRunResult> {
  const feePayer = await feePayerKeypair();
  const server = rpcServer();
  const { verifier, pool } = ids(r.pool);
  if (r.pool) await assertKovanPool(pool);

  const secret = await resolveAgentSecret(r.agent, verifier);

  const latest = (await withRetry(() => server.getLatestLedger())).sequence;
  const source = await withRetry(() => server.getAccount(feePayer.publicKey()));
  const op = buildOp(action, r);
  const tx1 = new TransactionBuilder(source, { fee: "10000", networkPassphrase: NETWORK_PASSPHRASE }).addOperation(op).setTimeout(120).build();
  const sim1 = await withRetry(() => server.simulateTransaction(tx1));
  if (rpc.Api.isSimulationError(sim1)) return { hash: "", status: "ERROR", stage: "simulate", error: explainError(sim1.error), raw: sim1.error };

  // Sign every entry that belongs to the agent account; leave any other as is.
  const entries = (sim1 as rpc.Api.SimulateTransactionSuccessResponse).result?.auth ?? [];
  const signed = entries.map((e) => onlyAgentEntry(e, r.agent, (entry) => signAgentEntry(entry, { verifier, secret, networkPassphrase: NETWORK_PASSPHRASE, expirationLedger: latest + EXPIRY_LEDGERS })));

  const hf = op.body().invokeHostFunctionOp().hostFunction();
  const source2 = await withRetry(() => server.getAccount(feePayer.publicKey()));
  const tx2 = new TransactionBuilder(source2, { fee: "10000", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeHostFunction({ func: hf, auth: signed }))
    .setTimeout(120)
    .build();
  const sim2 = await withRetry(() => server.simulateTransaction(tx2));
  if (rpc.Api.isSimulationError(sim2)) return { hash: "", status: "ERROR", stage: "simulate", error: explainError(sim2.error), raw: sim2.error };

  const prepared = rpc.assembleTransaction(tx2, sim2).build();
  prepared.sign(feePayer);
  const res = await submitSigned(prepared.toXDR());
  return { ...res, stage: "submit" };
}
