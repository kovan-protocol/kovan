import { NextResponse } from "next/server";
import { fetchEvents } from "@/lib/events";
import { assertKovanPool, ids } from "@/lib/stellar";

export async function GET(req: Request) {
  try {
    const poolId = new URL(req.url).searchParams.get("pool");
    await assertKovanPool(ids(poolId).pool);
    const { pool, policy } = ids(poolId);
    return NextResponse.json(await fetchEvents({ pool, policy }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
