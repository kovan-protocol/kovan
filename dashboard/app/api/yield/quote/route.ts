import { NextResponse } from "next/server";
import { assertKovanPool, ids, rejectCrossSite } from "@/lib/stellar";
import { quoteYield, type YieldAction } from "@/lib/yield";

/** Read-only preview. No transaction is signed or sent. */
export async function POST(req: Request) {
  const refused = rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  try {
    const { pool, action, amount } = await req.json() as { pool?: string; action: YieldAction; amount: string };
    const id = ids(pool).pool;
    await assertKovanPool(id);
    return NextResponse.json(await quoteYield(id, action, amount));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
