import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/lib/stellar";
import { submitSigned } from "@/lib/submit";
import { jsonSafe } from "@/lib/contracts";

export async function POST(req: Request) {
  const refused = rejectCrossSite(req);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  try {
    const { signedXdr } = (await req.json()) as { signedXdr: string };
    if (!signedXdr) return NextResponse.json({ error: "signedXdr required" }, { status: 400 });
    const result = await submitSigned(signedXdr);
    return NextResponse.json(jsonSafe(result), { status: result.status === "SUCCESS" ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
