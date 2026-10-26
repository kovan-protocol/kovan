import { Buffer } from "buffer";
import { Address, Contract, Operation, xdr } from "@stellar/stellar-sdk";
import { addrVal, amendmentToScVal, bytes32Val, covenantToScVal, positiveAmount, u32Val, type CovenantInput } from "./scval.js";

export const ownerFns = ["fund", "withdraw", "create_agent", "revoke", "amend", "close", "close_pool", "return_funds", "resolve_dispute"] as const;
export type OwnerFn = (typeof ownerFns)[number];
/** Integer token base units, never floating-point amounts. */
export type OwnerArgs = {
  fund: { amount: string };
  withdraw: { amount: string };
  create_agent: { agent_pubkey: string; draw_limit: string; covenant: Omit<CovenantInput, "pool" | "usdc"> };
  revoke: { agent: string; by: string };
  amend: { agent: string; draw_limit: string; amendment: Parameters<typeof amendmentToScVal>[0] };
  close: { agent: string; by: string };
  close_pool: Record<string, never>;
  return_funds: { agent: string; by: string; amount: string };
  resolve_dispute: { agent: string; outcome: number };
};

/** Pure operation builder. No network calls, signing, key storage, or submission. */
export function buildOwnerOp<F extends OwnerFn>(pool: string, fn: F, args: OwnerArgs[F], usdc = pool): xdr.Operation {
  const c = new Contract(pool);
  switch (fn) {
    case "close_pool": return c.call(fn);
    case "fund": case "withdraw": return c.call(fn, positiveAmount((args as OwnerArgs["fund"]).amount));
    case "create_agent": {
      const a = args as OwnerArgs["create_agent"];
      return c.call(fn, bytes32Val(a.agent_pubkey), positiveAmount(a.draw_limit), covenantToScVal({ ...a.covenant, pool, usdc }));
    }
    case "revoke": case "close": {
      const a = args as OwnerArgs["revoke"];
      return c.call(fn, addrVal(a.agent), addrVal(a.by));
    }
    case "amend": {
      const a = args as OwnerArgs["amend"];
      return c.call(fn, addrVal(a.agent), positiveAmount(a.draw_limit), amendmentToScVal(a.amendment));
    }
    case "return_funds": {
      const a = args as OwnerArgs["return_funds"];
      return c.call(fn, addrVal(a.agent), addrVal(a.by), positiveAmount(a.amount));
    }
    case "resolve_dispute": {
      const a = args as OwnerArgs["resolve_dispute"];
      return c.call(fn, addrVal(a.agent), u32Val(a.outcome));
    }
    default: throw new Error(`unknown owner function: ${String(fn)}`);
  }
}

export type CreatePoolParams = {
  owner: string; usdc: string; poolWasmHash: string; accountWasmHash: string;
  policy: string; verifier: string; salt: Uint8Array;
};
export function buildCreatePoolOp(p: CreatePoolParams): xdr.Operation {
  bytes32Val(p.poolWasmHash);
  if (p.salt.length !== 32) throw new Error("Pool salt must be exactly 32 bytes");
  return Operation.createCustomContract({
    address: new Address(p.owner), wasmHash: Buffer.from(p.poolWasmHash, "hex"), salt: Buffer.from(p.salt),
    constructorArgs: [addrVal(p.owner), addrVal(p.usdc), bytes32Val(p.accountWasmHash), addrVal(p.policy), addrVal(p.verifier)],
  });
}

export type AgentAction = "draw" | "pay" | "return";
export type AgentRequest = { agent: string; amount: string; to?: string };
export function buildAgentOp(pool: string, usdc: string, action: AgentAction, r: AgentRequest): xdr.Operation {
  const amount = positiveAmount(r.amount);
  switch (action) {
    case "draw": return new Contract(pool).call("draw", addrVal(r.agent), amount);
    case "pay":
      if (!r.to) throw new Error("to is required for pay");
      return new Contract(usdc).call("transfer", addrVal(r.agent), addrVal(r.to), amount);
    case "return": return new Contract(pool).call("return_funds", addrVal(r.agent), addrVal(r.agent), amount);
    default: throw new Error(`unknown agent action: ${String(action)}`);
  }
}
