/** Unstable v3 DeFindex ABI. NOT generic yield support; NOT enabled by the stable client. */
import { Contract, xdr } from "@stellar/stellar-sdk";
import { addrVal, bytes32Val, positiveAmount, u32Val } from "./scval.js";
export * from "./defindex.js";

export const yieldFns = ["configure_yield", "invest", "lock_shares", "redeem_shares", "release_shares"] as const;
export type YieldFn = (typeof yieldFns)[number];
export type YieldArgs = {
  configure_yield: { vault: string; wasm_hash: string };
  invest: { amount: string; min_shares: string; valid_until: number };
  lock_shares: { shares: string; min_assets: string; valid_until: number };
  redeem_shares: { shares: string; min_assets: string; valid_until: number };
  release_shares: { shares: string };
};
export type YieldInfo = {
  vault?: string | null; shares: bigint; share_balance_ok: boolean; share_decimals: number;
  estimated_assets: bigint; budget_backing: bigint; backing_bps: number; valuation_ok: boolean;
};
function deadline(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) throw new Error("Invalid quote expiry ledger");
  return u32Val(value);
}
/** Low-level only: callers must check deployed version, provider allowlist, code hash and asset. */
export function buildYieldOp<F extends YieldFn>(pool: string, fn: F, args: YieldArgs[F]): xdr.Operation {
  const c = new Contract(pool);
  switch (fn) {
    case "configure_yield": {
      const a = args as YieldArgs["configure_yield"];
      if (!/^C[A-Z2-7]{55}$/.test(a.vault)) throw new Error("Invalid vault address");
      return c.call(fn, addrVal(a.vault), bytes32Val(a.wasm_hash));
    }
    case "invest": {
      const a = args as YieldArgs["invest"];
      return c.call(fn, positiveAmount(a.amount), positiveAmount(a.min_shares), deadline(a.valid_until));
    }
    case "lock_shares": case "redeem_shares": {
      const a = args as YieldArgs["lock_shares"];
      return c.call(fn, positiveAmount(a.shares), positiveAmount(a.min_assets), deadline(a.valid_until));
    }
    case "release_shares": return c.call(fn, positiveAmount((args as YieldArgs["release_shares"]).shares));
    default: throw new Error(`unknown yield function: ${String(fn)}`);
  }
}
