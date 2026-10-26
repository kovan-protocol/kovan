// Kovan setup page: runs a whole plan from one link (create pool → fund →
// create agents). The owner connects Freighter once and approves each step.
// Persist signed pending transactions before broadcast; reconcile them on reload.
// Secrets stay in memory and must be backed up before any agent is deployed.
import { getNetwork, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import { Keypair } from "@stellar/stellar-sdk";
import { addrVal, signPrepared, transactionStatus, type SubmitResult } from "@kovan-protocol/sdk";
import { client, explorerContract, explorerTx, NETWORK_PASSPHRASE, prepare } from "./chain";
import { describeAgent, parsePlan, steps, type Plan } from "./plan";
import { encodeRequest, formatUsdc, RequestError, type SignRequest } from "./request";
import "./style.css";
import "./setup.css";
import "./appearance";

type Step = ReturnType<typeof steps>[number];
type Progress = {
  pool?: string; owner?: string; done: boolean[]; agents: (string | null)[]; txs: (string | null)[];
  publicKeys?: Record<number, string>;
  pending?: { index: number; hash: string; xdr?: string };
};

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
  const saved = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) ?? "null") as Progress | null;
  if (!saved) return empty;
  if (!Array.isArray(saved.done) || saved.done.length !== list.length || saved.done.some(d => typeof d !== "boolean")
      || !Array.isArray(saved.agents) || saved.agents.length !== plan.agents.length || !Array.isArray(saved.txs) || saved.txs.length !== list.length) {
    throw new Error("Saved setup progress is invalid. Reconcile the existing transactions before starting a new setup.");
  }
  // Preserve unknown hashes written by the older setup page. Never rebuild
  // those steps simply because their signed envelope was not retained.
  const unknown = saved.txs.map((hash, index) => !saved.done[index] && hash ? { index, hash } : null).filter(x => x !== null);
  if (unknown.length > 1) throw new Error("Multiple unresolved transactions; reconcile them before continuing.");
  saved.pending ??= unknown[0];
  if (saved.pending && (!Number.isInteger(saved.pending.index) || saved.pending.index < 0 || saved.pending.index >= list.length
      || saved.done[saved.pending.index] || !/^[a-f0-9]{64}$/.test(saved.pending.hash))) throw new Error("Invalid pending transaction; reconcile before continuing.");
  return saved;
}

function save() {
  // Persistence is a prerequisite to submission, not a best-effort convenience.
  sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
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
    } else if (tx) {
      li.append(" ", link("Check pending transaction", explorerTx(tx)));
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
    if (progress.owner && progress.owner !== owner) throw new Error("Reconnect the wallet that started this setup.");
    progress.owner = owner;
    save();
    prepareKeys();
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

async function signAndSend(req: SignRequest, index: number): Promise<SubmitResult> {
  const prepared = await prepare(req, owner!);
  const signed = await signPrepared(prepared, async (xdr, ctx) => {
    const r = await signTransaction(xdr, { networkPassphrase: ctx.networkPassphrase, address: ctx.address });
    if (r.error) throw new Error(errText(r.error, "Signing was cancelled"));
    return r.signedTxXdr;
  });
  progress.pending = { index, hash: prepared.hash, xdr: signed };
  progress.txs[index] = prepared.hash;
  save(); // Must succeed BEFORE the first possible broadcast.
  return client.submit(signed);
}

function prepareKeys() {
  progress.publicKeys ??= {};
  plan.agents.forEach((a, i) => {
    if (a.keyGiven || progress.publicKeys![i] || progress.agents[i]) return;
    // An old pending deployment must be reconciled before generating a key.
    if (progress.pending && list[progress.pending.index]?.agent === i) return;
    const key = Keypair.random();
    keys.set(i, key);
    progress.publicKeys![i] = key.publicKey();
    keysSaved = false;
  });
  save();
  $("keys").hidden = !plan.agents.some(a => !a.keyGiven);
}

function requestFor(step: Step): SignRequest {
  const pool = plan.pool ?? progress.pool;
  if (step.kind === "create_pool") return { fn: "create_pool" };
  if (!pool) throw new Error("The pool doesn't exist yet");
  if (step.kind === "fund") return { fn: "fund", pool, amount: plan.fund! };
  const a = plan.agents[step.agent!];
  if (a.keyGiven) return { ...a.req, pool };
  const kp = keys.get(step.agent!);
  if (!kp) throw new Error("Import your saved agent-key backup to resume. A replacement key would not control an already-created agent.");
  if (!keysSaved) throw new Error("Download the agent-key backup and confirm it is saved before deploying agents.");
  return { ...a.req, pool, agentKey: kp.publicKey(), agentPubkeyHex: kp.rawPublicKey().toString("hex") };
}

async function run() {
  if (busy || !owner) return;
  busy = true;
  const button = $("run") as HTMLButtonElement;
  button.disabled = true;
  try {
    if (progress.owner !== owner) throw new Error("Reconnect the wallet that started this setup.");
    for (let i = 0; i < list.length; i++) {
      if (progress.done[i]) continue;
      const step = list[i];
      let r: SubmitResult;
      if (progress.pending) {
        if (progress.pending.index !== i) throw new Error("Reconcile the pending step before continuing.");
        status(`Checking the saved transaction for step ${i + 1}. No new approval or payment is being created.`);
        r = await transactionStatus(client, progress.pending.hash);
        if (r.status === "NOT_FOUND" && progress.pending.xdr) { save(); r = await client.submit(progress.pending.xdr); }
      } else {
        status(`Step ${i + 1} of ${list.length}: ${step.label}. Approve it in Freighter.`);
        r = await signAndSend(requestFor(step), i);
      }
      if (r.status === "FAILED") {
        delete progress.pending;
        progress.txs[i] = null;
        save();
        throw new Error(r.error ?? "Transaction failed on-chain; this step can be tried again.");
      }
      if (r.status !== "SUCCESS") throw new Error(`Step ${i + 1} is unresolved (${progress.pending?.hash}). Continue only checks/resends this same transaction, never a new payment. ${r.error ?? ""}`);
      if ((step.kind === "agent" || step.kind === "create_pool") && typeof r.returnValue !== "string") throw new Error("Confirmed deployment has no readable address. Reconcile its result before continuing.");
      if (step.kind === "create_pool") progress.pool = String(r.returnValue);
      if (step.kind === "agent") {
        progress.agents[step.agent!] = String(r.returnValue);
        const kp = keys.get(step.agent!);
        // Testnet XLM for the agent's fees. Best effort: the summary says how to do it by hand.
        if (kp) void fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`).catch(() => {});
      }
      progress.done[i] = true;
      progress.txs[i] = r.hash;
      delete progress.pending;
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
  return plan.agents[i].keyGiven ? plan.agents[i].req.agentKey : progress.publicKeys?.[i] ?? "(import backup; legacy key unavailable)";
}

function summary(): string {
  const pool = plan.pool ?? progress.pool!;
  const lines = ["Kovan setup done (Stellar testnet).", `Pool: ${pool}${plan.fund !== undefined ? ` (funded ${formatUsdc(plan.fund)})` : ""}`];
  plan.agents.forEach((a, i) => {
    lines.push(`Agent "${a.name}": wallet ${progress.agents[i]}, key ${agentKey(i)}. ${describeAgent(a).slice(0, -1).join(". ")}`);
  });
  lines.push(`Transactions: ${progress.txs.filter(Boolean).join(", ")}`);
  lines.push("Before a new agent can pay: approve a separate exact/budget mandate in the console or with owner create_mandate. Funding/drawing alone does not grant payment authority.");
  return lines.join("\n");
}

function finish() {
  $("run").hidden = true;
  status("Pool and agents created. New agents still need a separate owner-approved payment mandate before spending.", "ok");
  const pool = plan.pool ?? progress.pool!;
  const res = $("result");
  const links = $("links");
  links.replaceChildren(link("View pool", explorerContract(pool)), ...progress.agents.flatMap((a, i) => a ? [link(`View ${plan.agents[i].name}`, explorerContract(a))] : []));
  $("result-json").textContent = summary();
  $("keys").hidden = !plan.agents.some(a => !a.keyGiven);
  res.hidden = false;
}

function downloadKeys() {
  const pool = plan.pool ?? progress.pool;
  const agents = [...keys.entries()].map(([i, kp]) => ({
    index: i, name: plan.agents[i].name, agent: progress.agents[i], public_key: kp.publicKey(), secret: kp.secret(),
  }));
  if (!agents.length) { status("Import your existing backup; no secret keys are available in this tab.", "error"); return; }
  const body = JSON.stringify({
    kind: "kovan-agent-keys", version: 2, network: "testnet", plan: location.search, pool, agents,
    use: "Give each secret only to the agent runtime that spends for it, e.g. KOVAN_AGENT_SECRET=S… node kovan.mjs agent draw --pool … --agent … --amount 1. Never paste it into a chat.",
  }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `kovan-agent-keys-${pool?.slice(0, 8) ?? "setup"}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ($("backup-confirm") as HTMLInputElement).disabled = false;
}

async function importKeys() {
  const input = $("import-keys") as HTMLInputElement;
  try {
    const file = input.files?.[0];
    if (!file || file.size > 100_000) throw new Error("Select a valid small JSON key backup.");
    const backup = JSON.parse(await file.text());
    if (backup.kind !== "kovan-agent-keys" || backup.version !== 2 || backup.network !== "testnet" || backup.plan !== location.search || !Array.isArray(backup.agents)) throw new Error("Backup does not match this setup link.");
    const restored = new Map<number, Keypair>();
    for (const a of backup.agents) {
      if (!Number.isInteger(a.index) || !plan.agents[a.index] || plan.agents[a.index].keyGiven || restored.has(a.index)) throw new Error("Invalid backup agent.");
      const key = Keypair.fromSecret(a.secret);
      if (key.publicKey() !== a.public_key || progress.publicKeys?.[a.index] !== a.public_key) throw new Error("Backup key does not match the saved deployment key.");
      restored.set(a.index, key);
    }
    if (Object.keys(progress.publicKeys ?? {}).some(i => !restored.has(Number(i)))) throw new Error("Incomplete backup.");
    for (const [i, key] of restored) keys.set(i, key);
    keysSaved = true;
    const check = $("backup-confirm") as HTMLInputElement; check.checked = true; check.disabled = false;
    status("Backup restored locally. No keys were sent to a server.", "ok");
  } catch { status("Could not restore this backup. It must match the setup link and saved public keys.", "error"); }
  finally { input.value = ""; }
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
  $("import-keys").addEventListener("change", importKeys);
  $("backup-confirm").addEventListener("change", () => { keysSaved = ($("backup-confirm") as HTMLInputElement).checked; });
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
  try { progress = load(); }
  catch (e) { status(`Cannot safely resume: ${(e as Error).message}`, "error"); return; }
  $("empty").hidden = true;
  renderPlan();
  if (progress.done.every(Boolean)) { status("This setup was already completed in this tab.", "ok"); finish(); }
}

start();
