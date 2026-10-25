// Owner-side operations on the pool. Pure op construction here; the API route
// simulates/assembles and the browser signs with Freighter.
import { Address, Contract, Operation, xdr } from "@stellar/stellar-sdk";
import { addrVal, amendmentToScVal, bytes32Val, covenantToScVal, i128Val, type CovenantInput } from "./scval";

export const ownerFns = ["fund", "withdraw", "create_agent", "revoke", "amend", "close", "close_pool", "return_funds", "resolve_dispute"] as const;
export type OwnerFn = (typeof ownerFns)[number];

// JSON shapes the browser sends. Amounts are base-unit strings.
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

/** `pool` and `usdc` are overwritten by the contract; placeholders keep the struct shape. */
export function buildOwnerOp<F extends OwnerFn>(pool: string, fn: F, args: OwnerArgs[F], usdc = pool): xdr.Operation {
  const c = new Contract(pool);
  switch (fn) {
    case "close_pool":
      return c.call(fn);
    case "fund":
    case "withdraw": {
      const a = args as OwnerArgs["fund"];
      return c.call(fn, i128Val(a.amount));
    }
    case "create_agent": {
      const a = args as OwnerArgs["create_agent"];
      return c.call(fn, bytes32Val(a.agent_pubkey), i128Val(a.draw_limit), covenantToScVal({ ...a.covenant, pool, usdc }));
    }
    case "revoke":
    case "close": {
      const a = args as OwnerArgs["revoke"];
      return c.call(fn, addrVal(a.agent), addrVal(a.by));
    }
    case "amend": {
      const a = args as OwnerArgs["amend"];
      return c.call(fn, addrVal(a.agent), i128Val(a.draw_limit), amendmentToScVal(a.amendment));
    }
    case "return_funds": {
      const a = args as OwnerArgs["return_funds"];
      return c.call(fn, addrVal(a.agent), addrVal(a.by), i128Val(a.amount));
    }
    case "resolve_dispute": {
      const a = args as OwnerArgs["resolve_dispute"];
      return c.call(fn, addrVal(a.agent), xdr.ScVal.scvU32(a.outcome));
    }
    default:
      throw new Error(`unknown owner function: ${String(fn)}`);
  }
}

export type CreatePoolParams = { owner: string; usdc: string; poolWasmHash: string; accountWasmHash: string; policy: string; verifier: string; salt: Buffer };

/** Deploys a new pool instance from the uploaded pool wasm; the owner's address seeds the contract id. */
export function buildCreatePoolOp(p: CreatePoolParams): xdr.Operation {
  return Operation.createCustomContract({
    address: new Address(p.owner),
    wasmHash: Buffer.from(p.poolWasmHash, "hex"),
    salt: p.salt,
    constructorArgs: [addrVal(p.owner), addrVal(p.usdc), bytes32Val(p.accountWasmHash), addrVal(p.policy), addrVal(p.verifier)],
  });
}
