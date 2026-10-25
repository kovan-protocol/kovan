// Server-only: runs an agent action end to end with the agent key from .env.
//   build (fee payer as source) → simulate → sign the agent's auth entry →
//   re-simulate with the signed entry (covenant runs here; a refusal is decoded
//   before anything is submitted) → assemble → fee payer signs → submit.
import { Address, Contract, Keypair, Operation, rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { agentPubkeyHex, signAgentEntry } from "./authpayload";
import { simulateRead } from "./contracts";
import { explainError } from "./errors";
import { addrVal, i128Val } from "./scval";
import { ids, NETWORK_PASSPHRASE, rpcServer, withRetry } from "./stellar";
import { submitSigned, type SubmitResult } from "./submit";

export type AgentAction = "draw" | "pay" | "return";
export type AgentRequest = { agent: string; amount: string; to?: string; pool?: string };

/** Auth entries expire this many ledgers after the latest one (~5 min). */
const EXPIRY_LEDGERS = 60;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in dashboard/.env.local`);
  return v;
}

/** The on-chain rule-0 signer must be External(verifier, pubkey) for the configured secret. */
export async function assertAgentKeyMatches(agent: string, secret: string): Promise<void> {
  const rule = await simulateRead<{ signers: unknown[] }>(agent, "get_context_rule", [xdr.ScVal.scvU32(0)]);
  const signer = rule.signers?.[0] as [string, string, Buffer] | undefined;
  const onchain = signer && Buffer.isBuffer(signer[2]) ? signer[2].toString("hex") : "";
  const mine = agentPubkeyHex(secret);
  if (onchain !== mine) {
    throw new Error(`agent key does not match account: on-chain signer ${onchain.slice(0, 8)}…, AGENT_SECRET derives ${mine.slice(0, 8)}…`);
  }
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
  const secret = env("AGENT_SECRET");
  const feePayer = Keypair.fromSecret(env("FEE_PAYER_SECRET"));
  const server = rpcServer();
  const { verifier } = ids(r.pool);

  await assertAgentKeyMatches(r.agent, secret);

  const latest = (await withRetry(() => server.getLatestLedger())).sequence;
  const source = await withRetry(() => server.getAccount(feePayer.publicKey()));
  const op = buildOp(action, r);
  const tx1 = new TransactionBuilder(source, { fee: "10000", networkPassphrase: NETWORK_PASSPHRASE }).addOperation(op).setTimeout(120).build();
  const sim1 = await withRetry(() => server.simulateTransaction(tx1));
  if (rpc.Api.isSimulationError(sim1)) return { hash: "", status: "ERROR", stage: "simulate", error: explainError(sim1.error), raw: sim1.error };

  // Sign every entry that belongs to the agent account; leave any other as is.
  const entries = (sim1 as rpc.Api.SimulateTransactionSuccessResponse).result?.auth ?? [];
  const signed = entries.map((e) => {
    if (e.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) return e;
    const who = Address.fromScAddress(e.credentials().address().address()).toString();
    return who === r.agent ? signAgentEntry(e, { verifier, secret, networkPassphrase: NETWORK_PASSPHRASE, expirationLedger: latest + EXPIRY_LEDGERS }) : e;
  });

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
