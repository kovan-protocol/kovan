import { NextResponse } from "next/server";
import { discoverTerms, payEndpoint } from "@/lib/agent-x402";

/** GET ?url= → the endpoint's 402 terms. POST {agent, url} → pay it as the agent. */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  try {
    const t = await discoverTerms(url);
    return NextResponse.json({ url: t.url, description: t.description, payTo: t.payTo, amount: t.amount, asset: t.asset, maxTimeoutSeconds: t.maxTimeoutSeconds });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}

export async function POST(req: Request) {
  try {
    const { agent, url } = (await req.json()) as { agent: string; url: string };
    if (!agent || !url) return NextResponse.json({ error: "agent and url are required" }, { status: 400 });
    const r = await payEndpoint(agent, url);
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, stage: "guard", error: msg }, { status: /SECRET|does not match/.test(msg) ? 400 : 500 });
  }
}
