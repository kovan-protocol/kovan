import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/lib/stellar";
import { KovanError, prepareOperation } from "@kovan/sdk";
import { buildCreatePoolOp, buildOwnerOp, ownerFns, yieldFns, type OwnerArgs, type OwnerFn } from "@/lib/owner";
import { readPool, readYield } from "@/lib/contracts";
import { requireListedVault } from "@/lib/yield";
import { randomBytes } from "node:crypto";
import { assertKovanPool, ids, NETWORK_PASSPHRASE, rpcServer } from "@/lib/stellar";
import { explainError } from "@/lib/errors";

type Body = { fn: OwnerFn | "create_pool"; args: OwnerArgs[OwnerFn] | Record<string, never>; source: string; pool?: string };

/** Builds, simulates and assembles an owner transaction. Returns unsigned XDR for Freighter. */
export async function POST(req: Request) {
  const refused = rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  let context: { usdc?: string; pool?: string } = {};
  try {
    const { fn, args, source, pool: poolOverride } = (await req.json()) as Body;
    if (fn !== "create_pool" && !ownerFns.includes(fn)) return NextResponse.json({ error: `unknown function ${fn}` }, { status: 400 });
    const server = rpcServer();
    const id = ids(poolOverride);
    context = { usdc: id.usdc, pool: id.pool };
    if (fn !== "create_pool") await assertKovanPool(id.pool);
    if ((yieldFns as readonly string[]).includes(fn)) {
      await assertKovanPool(id.pool);
      const p = await readPool(id.pool);
      if ((p.accounting_version ?? 1) < 3) return NextResponse.json({ error: "This pool is cash-only. Yield needs a newly deployed v3 pool." }, { status: 422 });
      if (p.owner !== source) return NextResponse.json({ error: "Connect the original pool owner’s wallet" }, { status: 403 });
      if (fn === "configure_yield") {
        const a = args as OwnerArgs["configure_yield"];
        await requireListedVault(a.vault, p.usdc, a.wasm_hash);
      } else if (fn === "invest" || fn === "lock_shares") {
        const y = await readYield(id.pool);
        if (!y.vault) throw new Error("Configure a reviewed vault first");
        await requireListedVault(y.vault, p.usdc);
      }
      // Exits remain available after delisting; the contract enforces remaining commitments.
    }
    if (fn === "create_pool" && !id.poolWasmHash) return NextResponse.json({ error: "pool_wasm_hash missing from deployments/testnet.json" }, { status: 500 });
    const op =
      fn === "create_pool"
        ? buildCreatePoolOp({ owner: source, usdc: id.usdc, poolWasmHash: id.poolWasmHash, accountWasmHash: id.accountWasmHash, policy: id.policy, verifier: id.verifier, salt: randomBytes(32) })
        : buildOwnerOp(id.pool, fn, args as OwnerArgs[OwnerFn], id.usdc);
    const prepared = await prepareOperation({ rpc: server, networkPassphrase: NETWORK_PASSPHRASE }, { source, operation: op });
    return NextResponse.json({ xdr: prepared.xdr });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const raw = e instanceof KovanError ? e.raw : msg;
    return NextResponse.json({ error: explainError(raw, context), raw }, { status: e instanceof KovanError ? 422 : 500 });
  }
}
