import { NextResponse } from "next/server";
import { fetchEvents } from "@/lib/events";
import { ids } from "@/lib/stellar";

export async function GET(req: Request) {
  try {
    const { pool, policy } = ids(new URL(req.url).searchParams.get("pool"));
    return NextResponse.json(await fetchEvents({ pool, policy }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
