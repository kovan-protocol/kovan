import { NextResponse } from "next/server";
import { fetchEvents } from "@/lib/events";
import { assertKovanPool, ids } from "@/lib/stellar";

export async function GET(req: Request) {
  try {
    const poolId = new URL(req.url).searchParams.get("pool");
    const { pool, policy } = ids(poolId);
    if (poolId) await assertKovanPool(pool);
    return NextResponse.json(await fetchEvents({ pool, policy }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
