// A setup plan, written as a plain link a chat agent (ChatGPT, Grok…) can type
// without running code:
//
//   /setup?fund=100
//         &agent=name:research,draw:40,pay:G…|G…,per:0.5,total:40,hours:48
//         &agent=name:trading,draw:40,send:C…,send_per:1,send_total:5
//         [&pool=C…]   use an existing pool instead of creating one
//
// Every agent becomes the same create_agent request the signing page accepts,
// so all of its validation applies. The owner comes from the connected wallet.
import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import { formatUsdc, parseRequest, RequestError, usdc, type SignRequest } from "./request";

export const MAX_AGENTS = 5;
/** Stands in for the pool until it exists; never sent anywhere. */
const PLACEHOLDER_POOL = StrKey.encodeContract(Buffer.alloc(32, 0));

type AgentReq = Extract<SignRequest, { fn: "create_agent" }>;
export type PlanAgent = { name: string; keyGiven: boolean; req: AgentReq };
export type Plan = { pool?: string; fund?: bigint; agents: PlanAgent[] };

const fail = (msg: string): never => { throw new RequestError(msg); };

const AGENT_KEYS: Record<string, string> = {
  draw: "draw_limit", hours: "expiry_hours", key: "agent_key",
  pay: "providers", per: "provider_per_transfer_cap", total: "provider_total_cap",
  send: "recipients", send_per: "recipient_per_transfer_cap", send_total: "recipient_total_cap",
};

export function parsePlan(search: string): Plan | null {
  const q = new URLSearchParams(search);
  if (![...q.keys()].length) return null;
  const extra = [...new Set(q.keys())].filter((k) => !["fund", "pool", "agent"].includes(k));
  if (extra.length) fail(`Unknown link field ${extra.map((k) => `"${k}"`).join(", ")}. Use fund, pool and agent.`);
  if (q.getAll("fund").length > 1 || q.getAll("pool").length > 1) fail("Give fund and pool at most once.");

  const plan: Plan = { agents: [] };
  const pool = q.get("pool");
  if (pool !== null) {
    if (!StrKey.isValidContract(pool)) fail(`"pool" must be a contract address (C…).`);
    plan.pool = pool;
  }
  const fund = q.get("fund");
  if (fund !== null) plan.fund = usdc(fund, "fund", true);

  const specs = q.getAll("agent");
  if (specs.length > MAX_AGENTS) fail(`At most ${MAX_AGENTS} agents per link.`);
  specs.forEach((spec, i) => plan.agents.push(parseAgent(spec, i, plan.pool ?? PLACEHOLDER_POOL)));
  if (!plan.pool && plan.fund === undefined && !plan.agents.length) fail("The link has nothing to do.");

  // A new pool holds only what this link funds; agents can't be assigned more.
  if (!plan.pool && plan.agents.length) {
    const total = plan.agents.reduce((s, a) => s + a.req.drawLimit, 0n);
    if (total > (plan.fund ?? 0n)) fail(`The agents' draw limits add up to ${formatUsdc(total)}, more than the ${formatUsdc(plan.fund ?? 0n)} this link funds.`);
  }
  return plan;
}

function parseAgent(spec: string, i: number, pool: string): PlanAgent {
  const obj: Record<string, unknown> = { v: 1, fn: "create_agent", pool };
  let name = `agent-${i + 1}`;
  let keyGiven = false;
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(":");
    if (at < 1) fail(`Agent ${i + 1}: "${part}" should look like key:value.`);
    const k = part.slice(0, at).trim();
    const v = part.slice(at + 1).trim();
    if (k === "name") {
      if (!/^[A-Za-z0-9 ._-]{1,32}$/.test(v)) fail(`Agent ${i + 1}: name may use letters, digits, spaces, dots, dashes (max 32).`);
      name = v;
      continue;
    }
    const field = AGENT_KEYS[k];
    if (!field) fail(`Agent ${i + 1}: unknown field "${k}". Use name, draw, pay, per, total, send, send_per, send_total, hours, key.`);
    if (field in obj) fail(`Agent ${i + 1}: "${k}" appears twice.`);
    if (field === "providers" || field === "recipients") obj[field] = v.split("|").map((s) => s.trim()).filter(Boolean);
    else if (field === "expiry_hours") obj[field] = Number(v);
    else obj[field] = v;
    if (field === "agent_key") keyGiven = true;
  }
  // No key in the link: the page generates one in the owner's browser.
  if (!keyGiven) obj.agent_key = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
  try {
    return { name, keyGiven, req: parseRequest(obj) as AgentReq };
  } catch (e) {
    return fail(`Agent ${i + 1} (${name}): ${(e as Error).message}`);
  }
}

/** The plan as ordered steps; `pool` is filled in once the pool exists. */
export function steps(plan: Plan): { label: string; kind: "create_pool" | "fund" | "agent"; agent?: number }[] {
  const out: { label: string; kind: "create_pool" | "fund" | "agent"; agent?: number }[] = [];
  if (!plan.pool) out.push({ kind: "create_pool", label: "Create your pool" });
  if (plan.fund !== undefined) out.push({ kind: "fund", label: `Lock ${formatUsdc(plan.fund)} in the pool` });
  plan.agents.forEach((a, i) => out.push({ kind: "agent", agent: i, label: `Create agent "${a.name}" (${formatUsdc(a.req.drawLimit)} draw limit)` }));
  return out;
}

/** One agent's limits in plain words, for the review screen and the chat summary. */
export function describeAgent(a: PlanAgent): string[] {
  const r = a.req;
  const lines = [`Draw limit ${formatUsdc(r.drawLimit)} · expires in ${r.expiryHours} h`];
  if (r.providers.length) lines.push(`May pay ${r.providers.join(", ")}: ${formatUsdc(r.providerPerTransferCap)} per payment, ${formatUsdc(r.providerTotalCap)} total`);
  if (r.recipients.length) lines.push(`May send to ${r.recipients.join(", ")}: ${formatUsdc(r.recipientPerTransferCap)} per transfer, ${formatUsdc(r.recipientTotalCap)} total`);
  lines.push(a.keyGiven ? `Agent key ${r.agentKey}` : "Agent key: generated in this browser for you to download");
  return lines;
}
