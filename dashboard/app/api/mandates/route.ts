import { NextResponse } from "next/server";
import { jsonSafe } from "@kovan-protocol/sdk";
import { StrKey } from "@stellar/stellar-sdk";
import { kovanClient } from "@/lib/kovan";
import { ids } from "@/lib/stellar";

/** Chain reads only. Never signs or creates a mandate. */
export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const agent = query.get("agent"), id = query.get("id"), paymentId = query.get("paymentId");
    if (!agent || !StrKey.isValidContract(agent) || (!id && !paymentId)) return NextResponse.json({ error: "agent and mandate id or paymentId required" }, { status: 400 });
    if ([id, paymentId].some(value => value !== null && (!/^[a-fA-F0-9]{64}$/.test(value) || /^0{64}$/.test(value)))) return NextResponse.json({ error: "IDs must be nonzero 32-byte hex strings" }, { status: 400 });
    const poolId = ids(query.get("pool")).pool;
    const client = await kovanClient(poolId);
    await client.assertPool(poolId);
    const pool = client.pool(poolId);
    await pool.requireMandates(agent);
    const [mandate, payment] = await Promise.all([id ? pool.getMandate(agent, id) : null, paymentId ? pool.getPayment(agent, paymentId) : null]);
    return NextResponse.json(jsonSafe({ version: 1, pool: poolId, agent, mandate, payment }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: `Mandate read failed: ${(e as Error).message}. Legacy deployments do not implement mandate v1.` }, { status: 422 });
  }
}
