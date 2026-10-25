import { NextResponse } from "next/server";
import { runAgentAction, type AgentAction, type AgentRequest } from "@/lib/agent";
import { jsonSafe } from "@/lib/contracts";

const ACTIONS: AgentAction[] = ["draw", "pay", "return"];

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!ACTIONS.includes(action as AgentAction)) return NextResponse.json({ error: `unknown action ${action}` }, { status: 404 });
  try {
    const body = (await req.json()) as AgentRequest;
    if (!body.agent || !body.amount) return NextResponse.json({ error: "agent and amount are required" }, { status: 400 });
    const r = await runAgentAction(action as AgentAction, body);
    return NextResponse.json(jsonSafe(r), { status: r.status === "SUCCESS" ? 200 : 422 });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /AGENT_SECRET|FEE_PAYER_SECRET|does not match/.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg, stage: "guard" }, { status });
  }
}
