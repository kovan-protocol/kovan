// Dashboard configuration facade over the standalone SDK's read helpers.
import { simulateRead as sdkRead, type PoolInfo, type AgentRecord, type CovenantState } from "@kovan-protocol/sdk";
import type { YieldInfo } from "@kovan-protocol/sdk/experimental";
import type { xdr } from "@stellar/stellar-sdk";
import { addrVal } from "./scval";
import { ids, NETWORK_PASSPHRASE, rpcServer, withRetry } from "./stellar";
export { addrVal as addr, i128Val as i128, jsonSafe, type CovenantParams, type CovenantState, type AgentRecord, type PoolInfo } from "@kovan-protocol/sdk";
export type { YieldInfo } from "@kovan-protocol/sdk/experimental";

export function simulateRead<T>(contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<T> {
  return withRetry(() => sdkRead<T>({ rpc: rpcServer(), networkPassphrase: NETWORK_PASSPHRASE }, contractId, fn, args));
}
export function readYield(pool: string): Promise<YieldInfo> { return simulateRead(pool, "get_yield"); }
export async function readPool(pool?: string | null): Promise<PoolInfo> {
  const p = await simulateRead<PoolInfo>(ids(pool).pool, "get_pool");
  return { ...p, agent_count: Number(p.agent_count) };
}
export function listAgents(pool?: string | null): Promise<string[]> { return simulateRead(ids(pool).pool, "list_agents"); }
export async function readAgent(agent: string, pool?: string | null): Promise<AgentRecord & { state: CovenantState | null }> {
  const rec = await simulateRead<AgentRecord>(ids(pool).pool, "get_agent", [addrVal(agent)]);
  let state: CovenantState | null = null;
  try { state = await simulateRead<CovenantState>(ids(pool).policy, "get_covenant", [addrVal(agent)]); } catch { /* Unavailable policy state is explicit. */ }
  return { ...rec, state };
}
export function usdcBalance(account: string): Promise<bigint> { return simulateRead(ids().usdc, "balance", [addrVal(account)]); }
