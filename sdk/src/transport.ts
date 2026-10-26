import { Buffer } from "buffer";
import { Account, Contract, inspectAuthEntry, rpc, scValToNative, TransactionBuilder, type Transaction, type xdr } from "@stellar/stellar-sdk";
import { explainError, type ErrorContext } from "./errors.js";
import type { PreparedTransaction, RpcClient, Simulation, TransactionSigner } from "./types.js";

export class KovanError extends Error {
  constructor(public readonly stage: "guard" | "simulate" | "submit", public readonly raw: string, context: ErrorContext = {}) {
    super(explainError(raw, context)); this.name = "KovanError";
  }
}
export type Transport = { rpc: RpcClient; networkPassphrase: string };
export async function assertNetwork(t: Transport): Promise<void> {
  if ((await t.rpc.getNetwork()).passphrase !== t.networkPassphrase) throw new KovanError("guard", "RPC network does not match configured network passphrase");
}
export async function simulateRead<T>(t: Transport, contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<T> {
  const tx = new TransactionBuilder(new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0"), { fee: "100", networkPassphrase: t.networkPassphrase })
    .addOperation(new Contract(contractId).call(fn, ...args)).setTimeout(30).build();
  const sim = await t.rpc.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new KovanError("simulate", sim.error);
  const retval = (sim as Simulation).result?.retval;
  if (!retval) throw new KovanError("simulate", `no return value from ${fn}`);
  return scValToNative(retval) as T;
}

export function checkedSimulation(sim: rpc.Api.SimulateTransactionResponse, context: ErrorContext = {}): Simulation {
  if (rpc.Api.isSimulationError(sim)) throw new KovanError("simulate", sim.error, context);
  if (rpc.Api.isSimulationRestore(sim)) throw new KovanError("simulate", "Archived contract state needs restoration; restore explicitly before retrying");
  if (!(sim as Simulation).result) throw new KovanError("simulate", "Simulation returned no invocation result");
  return sim as Simulation;
}

/** Owner-source transactions must not silently request another account's signature. */
export function assertSourceAuthorization(sim: Simulation, source: string): void {
  for (const entry of sim.result?.auth ?? []) {
    const info = inspectAuthEntry(entry);
    if (info.credentialType === "sourceAccount") continue;
    if (info.credentialType === "addressWithDelegates" || info.address !== source) {
      throw new KovanError("guard", `needs a signature from ${info.address ?? "an unsupported signer"}, not ${source}`);
    }
  }
}

export function assemblePrepared(tx: Transaction, sim: Simulation, maxFeeStroops = "10000000"): PreparedTransaction {
  if (!/^\d+$/.test(maxFeeStroops) || BigInt(maxFeeStroops) <= 0n) throw new KovanError("guard", "Invalid maxFeeStroops");
  const prepared = rpc.assembleTransaction(tx, sim).build();
  if (BigInt(prepared.fee) > BigInt(maxFeeStroops)) throw new KovanError("guard", "Simulated transaction fee exceeds maxFeeStroops");
  return Object.freeze({ xdr: prepared.toXDR(), hash: prepared.hash().toString("hex"), source: prepared.source, networkPassphrase: prepared.networkPassphrase, preview: sim.result ? scValToNative(sim.result.retval) : undefined });
}

/** Public low-level helper used by the dashboard; caller must verify contract targets first. */
export async function prepareOperation(t: Transport, input: { source: string; operation: xdr.Operation; fee?: string; maxFeeStroops?: string }): Promise<PreparedTransaction> {
  await assertNetwork(t);
  const account = await t.rpc.getAccount(input.source);
  const tx = new TransactionBuilder(account, { fee: input.fee ?? "1000", networkPassphrase: t.networkPassphrase }).addOperation(input.operation).setTimeout(120).build();
  const sim = checkedSimulation(await t.rpc.simulateTransaction(tx));
  assertSourceAuthorization(sim, input.source);
  return assemblePrepared(tx, sim, input.maxFeeStroops);
}

export async function signPrepared(prepared: PreparedTransaction, signer: TransactionSigner): Promise<string> {
  const original = TransactionBuilder.fromXDR(prepared.xdr, prepared.networkPassphrase);
  if (original.hash().toString("hex") !== prepared.hash || !("source" in original) || original.source !== prepared.source) throw new KovanError("guard", "Prepared transaction has been modified");
  const signedXdr = await signer(prepared.xdr, { networkPassphrase: prepared.networkPassphrase, address: prepared.source });
  const signed = TransactionBuilder.fromXDR(signedXdr, prepared.networkPassphrase);
  if (!signed.hash().equals(original.hash())) throw new KovanError("guard", "Signer changed the transaction body");
  if (!signed.signatures.length) throw new KovanError("guard", "Signer returned an unsigned transaction");
  return signedXdr;
}

/** Explicit helper for Node callers who already control a keypair. */
export function keypairTransactionSigner(keypair: import("@stellar/stellar-sdk").Keypair): TransactionSigner {
  return async (transactionXdr, { networkPassphrase, address }) => {
    if (address !== keypair.publicKey()) throw new KovanError("guard", "Transaction source does not match signer");
    const tx = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
    tx.sign(keypair);
    return tx.toXDR();
  };
}

export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}
