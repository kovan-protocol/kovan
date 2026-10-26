// Kovan setup page: runs a whole plan from one link (create pool → fund →
// create agents). The owner connects Freighter once and approves each step.
// Progress (never keys) survives a reload, so a refresh can't create a second pool.
import { getNetwork, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import { Keypair } from "@stellar/stellar-sdk";
import { addrVal, type SubmitResult } from "@kovan/sdk";
import { client, explorerContract, explorerTx, NETWORK_PASSPHRASE, prepare } from "./chain";
import { describeAgent, parsePlan, steps, type Plan } from "./plan";
import { encodeRequest, formatUsdc, RequestError, type SignRequest } from "./request";
import "./style.css";
import "./setup.css";
import "./appearance";

type Step = ReturnType<typeof steps>[number];
type Progress = { pool?: string; done: boolean[]; agents: (string | null)[]; txs: (string | null)[] };

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const PROGRESS_KEY = "kovan-setup:" + location.search;

let plan: Plan;
let list: Step[] = [];
let owner: string | null = null;
let busy = false;
let progress: Progress;
const keys = new Map<number, Keypair>();
let keysSaved = true;

function el(tag: string, text?: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function link(text: string, href: string): HTMLAnchorElement {
  const a = el("a", text) as HTMLAnchorElement;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function status(text: string, kind: "info" | "error" | "ok" = "info") {
  const s = $("status");
  s.textContent = text;
  s.dataset.kind = kind;
  s.hidden = !text;
}

function load(): Progress {
  const empty: Progress = { done: list.map(() => false), agents: plan.agents.map(() => null), txs: list.map(() => null) };
  try {
    const saved = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) ?? "null") as Progress | null;
    if (saved && saved.done.length === list.length) return saved;
  } catch { /* start fresh */ }
  return empty;
}

function save() {
  try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* best effort */ }
}

const PLAIN: [RegExp, string][] = [
  [/ExceedsLocked/, "The pool doesn't hold enough unassigned USDC for this draw limit."],
  [/BalanceError/, "Your wallet doesn't hold enough testnet USDC for this step."],
  [/TrustlineMissing/, "Your wallet can't hold USDC yet: add the USDC trustline first."],
  [/original pool owner/, "This pool belongs to another wallet. Switch Freighter to the pool's owner."],
  [/Account not found|AccountMissing/, "This wallet doesn't exist on testnet yet. Fund it with testnet XLM (Freighter's \"Fund with Friendbot\")."],
];
const plain = (m: string) => { const h = PLAIN.find(([re]) => re.test(m)); return h ? `${h[1]} (${m})` : m; };
const errText = (e: unknown, fb: string) => typeof e === "string" ? e : (e as { message?: string })?.message ?? fb;

function renderPlan() {
  const rows = $("rows");
  const add = (k: string, v: string, mono = false) => { rows.append(el("dt", k), el("dd", v, mono ? "mono" : undefined)); };
  add("Pool", plan.pool ?? "A new pool, owned by the wallet you connect", !!plan.pool);
  if (plan.fund !== undefined) add("Funding", `${formatUsdc(plan.fund)} from your wallet`);
  add("Agents", plan.agents.length ? String(plan.agents.length) : "none");

  const agents = $("agents");
  agents.replaceChildren(...plan.agents.map((a) => {
    const card = el("div", undefined, "plan-agent");
    card.append(el("p", a.name, "plan-agent-name"));
    const ul = el("ul");
    ul.append(...describeAgent(a).map((l) => el("li", l)));
    card.append(ul);
    return card;
  }));
  agents.hidden = !plan.agents.length;
  renderSteps();
  $("plan").hidden = false;
  $("wallet").hidden = false;
}

function renderSteps() {
  const ol = $("steps");
  ol.replaceChildren(...list.map((s, i) => {
    const li = el("li");
    li.append(el("span", s.label));
    const tx = progress.txs[i];
    if (progress.done[i] && tx) {
      li.append(" ", link("✓ done", explorerTx(tx)));
      li.className = "step-done";
    }
    return li;
  }));
  const left = progress.done.filter((d) => !d).length;
  ($("run") as HTMLButtonElement).textContent = left === list.length
    ? `Start: ${left} approval${left === 1 ? "" : "s"} in Freighter`
    : `Continue: ${left} approval${left === 1 ? "" : "s"} left`;
}

async function connect() {
  if (busy) return;
  busy = true;
  try {
    const c = await isConnected();
    if (!c.isConnected) throw new Error("Freighter is not installed or is locked. Install it from freighter.app, unlock it, then try again.");
    const access = await requestAccess();
    if (access.error) throw new Error(errText(access.error, "Freighter refused access"));
    const net = await getNetwork();
    if (net.networkPassphrase !== NETWORK_PASSPHRASE) throw new Error(`Freighter is on ${net.network || "another network"}. Switch it to Testnet and try again.`);
    owner = access.address;
    $("owner").textContent = owner;
    $("connected").hidden = false;
    $("connect").hidden = true;
    $("run").hidden = false;
    status("");
    await checkBalance(owner);
  } catch (e) {
    status((e as Error).message, "error");
  } finally {
    busy = false;
  }
}

/** Warn early if the wallet can't cover the funding step. */
async function checkBalance(addr: string) {
  if (plan.fund === undefined || progress.done[list.findIndex((s) => s.kind === "fund")]) return;
  try {
    const balance = BigInt(await client.read<bigint>(client.contracts.usdc, "balance", [addrVal(addr)]));
    if (balance < plan.fund) {
      status(`Your wallet holds ${formatUsdc(balance)}; this link locks ${formatUsdc(plan.fund)}. Get testnet USDC from faucet.circle.com (Stellar Testnet) first.`, "error");
    }
  } catch {
    const trust = `${location.origin}/sign${encodeRequest({ v: 1, fn: "trustline" })}`;
    status(`Your wallet can't hold USDC yet. Add the USDC trustline first: ${trust}`, "error");
  }
}

async function signAndSend(req: SignRequest): Promise<SubmitResult> {
  const prepared = await prepare(req, owner!);
  return client.signAndSend(prepared, async (xdr, ctx) => {
    const r = await signTransaction(xdr, { networkPassphrase: ctx.networkPassphrase, address: ctx.address });
    if (r.error) throw new Error(errText(r.error, "Signing was cancelled"));
    return r.signedTxXdr;
  });
}

function requestFor(step: Step): SignRequest {
  const pool = plan.pool ?? progress.pool;
  if (step.kind === "create_pool") return { fn: "create_pool" };
  if (!pool) throw new Error("The pool doesn't exist yet");
  if (step.kind === "fund") return { fn: "fund", pool, amount: plan.fund! };
  const a = plan.agents[step.agent!];
  if (a.keyGiven) return { ...a.req, pool };
  let kp = keys.get(step.agent!);
  if (!kp) { kp = Keypair.random(); keys.set(step.agent!, kp); keysSaved = false; }
  return { ...a.req, pool, agentKey: kp.publicKey(), agentPubkeyHex: kp.rawPublicKey().toString("hex") };
}

async function run() {
  if (busy || !owner) return;
  busy = true;
  const button = $("run") as HTMLButtonElement;
  button.disabled = true;
  try {
    for (let i = 0; i < list.length; i++) {
      if (progress.done[i]) continue;
      const step = list[i];
      status(`Step ${i + 1} of ${list.length}: ${step.label}. Approve it in Freighter.`);
      const r = await signAndSend(requestFor(step));
      if (r.status === "NOT_FOUND") {
        progress.txs[i] = r.hash;
        save();
        throw new Error(`Step ${i + 1} was submitted but isn't confirmed yet (${r.hash.slice(0, 10)}…). Check it on stellar.expert before continuing, so nothing runs twice.`);
      }
      if (r.status !== "SUCCESS") throw new Error(r.error ?? `Step ${i + 1} ${r.status.toLowerCase()}`);
      if (step.kind === "create_pool") progress.pool = String(r.returnValue);
      if (step.kind === "agent") {
        progress.agents[step.agent!] = String(r.returnValue);
        const kp = keys.get(step.agent!);
        // Testnet XLM for the agent's fees. Best effort: the summary says how to do it by hand.
        if (kp) void fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`).catch(() => {});
      }
      progress.done[i] = true;
      progress.txs[i] = r.hash;
      save();
      renderSteps();
    }
    finish();
  } catch (e) {
    status(plain(errText(e, "Something went wrong")), "error");
    renderSteps();
    button.disabled = false;
  } finally {
    busy = false;
  }
}

function agentKey(i: number): string {
  return plan.agents[i].keyGiven ? plan.agents[i].req.agentKey : keys.get(i)?.publicKey() ?? "(generated key not in this tab)";
}

function summary(): string {
  const pool = plan.pool ?? progress.pool!;
  const lines = ["Kovan setup done (Stellar testnet).", `Pool: ${pool}${plan.fund !== undefined ? ` (funded ${formatUsdc(plan.fund)})` : ""}`];
  plan.agents.forEach((a, i) => {
    lines.push(`Agent "${a.name}": wallet ${progress.agents[i]}, key ${agentKey(i)}. ${describeAgent(a).slice(0, -1).join(". ")}`);
  });
  lines.push(`Transactions: ${progress.txs.filter(Boolean).join(", ")}`);
  return lines.join("\n");
}

function finish() {
  $("run").hidden = true;
  status("Done. Your pool and agents are on Stellar testnet.", "ok");
  const pool = plan.pool ?? progress.pool!;
  const res = $("result");
  const links = $("links");
  links.replaceChildren(link("View pool", explorerContract(pool)), ...progress.agents.flatMap((a, i) => a ? [link(`View ${plan.agents[i].name}`, explorerContract(a))] : []));
  $("result-json").textContent = summary();
  const generated = [...keys.keys()].filter((i) => progress.agents[i]);
  $("keys").hidden = !generated.length;
  res.hidden = false;
}

function downloadKeys() {
  const pool = plan.pool ?? progress.pool!;
  const agents = [...keys.entries()].filter(([i]) => progress.agents[i]).map(([i, kp]) => ({
    name: plan.agents[i].name, agent: progress.agents[i], public_key: kp.publicKey(), secret: kp.secret(),
  }));
  const body = JSON.stringify({
    kind: "kovan-agent-keys", version: 1, network: "testnet", pool, agents,
    use: "Give each secret only to the agent runtime that spends for it, e.g. KOVAN_AGENT_SECRET=S… node kovan.mjs agent draw --pool … --agent … --amount 1. Never paste it into a chat.",
  }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `kovan-agent-keys-${pool.slice(0, 8)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  keysSaved = true;
}

async function copySummary() {
  try { await navigator.clipboard.writeText(summary()); $("copy").textContent = "Copied"; }
  catch { $("copy").textContent = "Select the text and copy"; }
}

function start() {
  $("connect").addEventListener("click", connect);
  $("run").addEventListener("click", run);
  $("copy").addEventListener("click", copySummary);
  $("download").addEventListener("click", downloadKeys);
  window.addEventListener("beforeunload", (e) => { if (!keysSaved) e.preventDefault(); });
  let parsed: Plan | null;
  try {
    parsed = parsePlan(location.search);
  } catch (e) {
    $("empty").hidden = true;
    status(e instanceof RequestError ? e.message : "This link could not be read.", "error");
    return;
  }
  if (!parsed) return;
  plan = parsed;
  list = steps(plan);
  progress = load();
  $("empty").hidden = true;
  renderPlan();
  if (progress.done.every(Boolean)) { status("This setup was already completed in this tab.", "ok"); finish(); }
}

start();
