import { NextResponse } from "next/server";
import { defaultKeystore } from "@/lib/keystore";
import { rejectCrossSite } from "@/lib/stellar";

/** GET → public info of locally held agent keys. POST {label} → generate one, return public parts only. */
export async function GET() {
  return NextResponse.json({ keys: defaultKeystore().list() });
}

export async function POST(req: Request) {
  const refused = rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  const { label } = ((await req.json().catch(() => ({}))) as { label?: string }) ?? {};
  const info = defaultKeystore().generate((label ?? "agent").slice(0, 40));
  return NextResponse.json(info);
}
