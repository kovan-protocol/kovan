// Typed read helpers. Reads are simulations against a null source account;
// nothing is signed or submitted here.
import {
  Account,
  Address,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import { ids, NETWORK_PASSPHRASE, rpcServer, withRetry } from "./stellar";

/** Any funded-looking account works for simulation of read-only calls. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export type CovenantParams = {
  pool: string;
  usdc: string;
  providers: string[];
  provider_per_transfer_cap: bigint;
  provider_total_cap: bigint;
  recipients: string[];
  recipient_per_transfer_cap: bigint;
  recipient_total_cap: bigint;
  calls: { contract: string; fn_name: string; amount_arg: number | undefined; amount_cap: bigint }[];
  expiry: number;
};

export type CovenantState = {
  params: CovenantParams;
  rule_id: number;
  provider_spent: bigint;
  recipient_spent: bigint;
  revoked: boolean;
};

export type AgentRecord = {
  covenant: CovenantParams;
  draw_limit: bigint;
  drawn: bigint;
  status: string;
  parent: string | undefined;
  children: string[];
  dispute: { by: string; evidence: Buffer; outcome: number | undefined }[];
};

export type PoolInfo = { owner: string; usdc: string; locked: bigint; sum_limits: bigint; agent_count: number };

/** Simulates `contract.fn(args)` and returns the decoded return value. */
export async function simulateRead<T>(contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<T> {
  const server = rpcServer();
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: "100", networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();
  const sim = await withRetry(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const retval = (sim as rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (!retval) throw new Error(`no return value from ${fn}`);
  return scValToNative(retval) as T;
}

export const addr = (a: string) => new Address(a).toScVal();
export const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });

export async function readPool(pool?: string | null): Promise<PoolInfo> {
  const p = await simulateRead<PoolInfo & { agent_count: number | bigint }>(ids(pool).pool, "get_pool");
  return { ...p, agent_count: Number(p.agent_count) };
}

export async function listAgents(pool?: string | null): Promise<string[]> {
  return simulateRead<string[]>(ids(pool).pool, "list_agents");
}

export async function readAgent(agent: string, pool?: string | null): Promise<AgentRecord & { state: CovenantState | null }> {
  const rec = await simulateRead<AgentRecord>(ids(pool).pool, "get_agent", [addr(agent)]);
  let state: CovenantState | null = null;
  try {
    state = await simulateRead<CovenantState>(ids().policy, "get_covenant", [addr(agent)]);
  } catch {
    state = null;
  }
  return { ...rec, state };
}

export async function usdcBalance(account: string): Promise<bigint> {
  return simulateRead<bigint>(ids().usdc, "balance", [addr(account)]);
}

/** JSON-safe: bigint → string recursively. */
export function jsonSafe<T>(v: T): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return v.toString("hex");
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}
