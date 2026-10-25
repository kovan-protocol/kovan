import { NextResponse } from "next/server";
import { fetchEvents } from "@/lib/events";
import { ids } from "@/lib/stellar";

export async function GET() {
  try {
    const { pool, policy } = ids();
    return NextResponse.json(await fetchEvents({ pool, policy }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
