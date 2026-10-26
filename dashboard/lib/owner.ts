// Compatibility facade: stable SDK operations plus explicitly experimental v3 yield.
import { buildOwnerOp as buildCoreOp, ownerFns as coreFns, type OwnerFn as CoreFn, type OwnerArgs as CoreArgs } from "@kovan/sdk";
import { buildYieldOp, yieldFns, type YieldArgs, type YieldFn } from "@kovan/sdk/experimental";
export { buildCreatePoolOp, type CreatePoolParams } from "@kovan/sdk";
export { yieldFns };
export const ownerFns = [...coreFns, ...yieldFns] as const;
export type OwnerFn = CoreFn | YieldFn;
export type OwnerArgs = CoreArgs & YieldArgs;
export function buildOwnerOp<F extends OwnerFn>(pool: string, fn: F, args: OwnerArgs[F], usdc = pool) {
  return (yieldFns as readonly string[]).includes(fn)
    ? buildYieldOp(pool, fn as YieldFn, args as YieldArgs[YieldFn])
    : buildCoreOp(pool, fn as CoreFn, args as CoreArgs[CoreFn], usdc);
}
