import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/lib/stellar";
import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { buildCreatePoolOp, buildOwnerOp, ownerFns, type OwnerArgs, type OwnerFn } from "@/lib/owner";
import { randomBytes } from "node:crypto";
import { Address, xdr } from "@stellar/stellar-sdk";
import { assertKovanPool, ids, NETWORK_PASSPHRASE, rpcServer, withRetry } from "@/lib/stellar";
import { explainError } from "@/lib/errors";

type Body = { fn: OwnerFn | "create_pool"; args: OwnerArgs[OwnerFn] | Record<string, never>; source: string; pool?: string };

/** Builds, simulates and assembles an owner transaction. Returns unsigned XDR for Freighter. */
export async function POST(req: Request) {
  const refused = rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  try {
    const { fn, args, source, pool: poolOverride } = (await req.json()) as Body;
    if (fn !== "create_pool" && !ownerFns.includes(fn)) return NextResponse.json({ error: `unknown function ${fn}` }, { status: 400 });
    const server = rpcServer();
    const id = ids(poolOverride);
    if (poolOverride) await assertKovanPool(id.pool);
    const account = await withRetry(() => server.getAccount(source));
    if (fn === "create_pool" && !id.poolWasmHash) return NextResponse.json({ error: "pool_wasm_hash missing from deployments/testnet.json" }, { status: 500 });
    const op =
      fn === "create_pool"
        ? buildCreatePoolOp({ owner: source, usdc: id.usdc, poolWasmHash: id.poolWasmHash, accountWasmHash: id.accountWasmHash, policy: id.policy, verifier: id.verifier, salt: randomBytes(32) })
        : buildOwnerOp(id.pool, fn, args as OwnerArgs[OwnerFn], id.usdc);
    const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(op)
      .setTimeout(120)
      .build();
    const sim = await withRetry(() => server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      return NextResponse.json({ error: explainError(sim.error, { usdc: id.usdc, pool: id.pool }), raw: sim.error }, { status: 422 });
    }
    // Preflight: recording mode happily records someone else's required auth; say so before Freighter opens.
    const needs = ((sim as rpc.Api.SimulateTransactionSuccessResponse).result?.auth ?? [])
      .filter((a) => a.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress())
      .map((a) => Address.fromScAddress(a.credentials().address().address()).toString())
      .filter((who) => who !== source);
    if (needs.length) return NextResponse.json({ error: `needs a signature from ${needs[0].slice(0, 8)}… (the pool owner), not ${source.slice(0, 8)}…` }, { status: 422 });
    const prepared = rpc.assembleTransaction(tx, sim).build();
    return NextResponse.json({ xdr: prepared.toXDR() });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return NextResponse.json({ error: explainError(msg), raw: msg }, { status: 500 });
  }
}
