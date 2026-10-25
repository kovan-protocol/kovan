import { NextResponse } from "next/server";
import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { buildOwnerOp, ownerFns, type OwnerArgs, type OwnerFn } from "@/lib/owner";
import { ids, NETWORK_PASSPHRASE, rpcServer } from "@/lib/stellar";
import { explainError } from "@/lib/errors";

type Body = { fn: OwnerFn; args: OwnerArgs[OwnerFn]; source: string };

/** Builds, simulates and assembles an owner transaction. Returns unsigned XDR for Freighter. */
export async function POST(req: Request) {
  try {
    const { fn, args, source } = (await req.json()) as Body;
    if (!ownerFns.includes(fn)) return NextResponse.json({ error: `unknown function ${fn}` }, { status: 400 });
    const server = rpcServer();
    const { pool, usdc } = ids();
    const account = await server.getAccount(source);
    const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(buildOwnerOp(pool, fn, args, usdc))
      .setTimeout(120)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      return NextResponse.json({ error: explainError(sim.error), raw: sim.error }, { status: 422 });
    }
    const prepared = rpc.assembleTransaction(tx, sim).build();
    return NextResponse.json({ xdr: prepared.toXDR() });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return NextResponse.json({ error: explainError(msg), raw: msg }, { status: 500 });
  }
}
