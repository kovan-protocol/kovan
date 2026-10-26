// Kovan sign page: read the request from the link, connect Freighter, build
// the transaction for the connected wallet, sign, submit, and deliver the
// result to the agent's callback (or show it for copying).
import { getNetwork, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import { KovanError, type PreparedTransaction, type SubmitResult } from "@kovan-protocol/sdk";
import { client, explorerContract, explorerTx, NETWORK_PASSPHRASE, prepare } from "./chain";
import { describe, parseHash, RequestError, type Envelope } from "./request";
import "./style.css";
import "./appearance";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DONE_KEY = "kovan-signed:";

let env: Envelope | null = null;
let owner: string | null = null;
let busy = false;

function el(tag: string, text?: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function status(text: string, kind: "info" | "error" | "ok" = "info") {
  const s = $("status");
  s.textContent = text;
  s.dataset.kind = kind;
  s.hidden = !text;
}

function storage<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function renderRequest(e: Envelope) {
  const s = describe(e.req);
  $("title").textContent = s.title;
  const rows = $("rows");
  rows.replaceChildren();
  const add = (k: string, v: string) => {
    rows.append(el("dt", k));
    const dd = el("dd", v);
    if (/^[CG][A-Z2-7]{55}/.test(v)) dd.classList.add("mono");
    rows.append(dd);
  };
  for (const [k, v] of s.rows) add(k, v);
  if (e.callback) add("Result goes to", new URL(e.callback).host);
  const notes = $("notes");
  notes.replaceChildren(...s.notes.map((n) => el("li", n)));
  notes.hidden = !s.notes.length;
  $("request").hidden = false;
  $("wallet").hidden = false;

  const prior = storage(() => localStorage.getItem(DONE_KEY + location.hash));
  if (prior) status(`This link was already signed in this browser (transaction ${prior.slice(0, 10)}…). Signing again would repeat the action.`, "error");
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
    $("sign").hidden = false;
    status("");
  } catch (e) {
    status((e as Error).message, "error");
  } finally {
    busy = false;
  }
}

async function sign() {
  if (busy || !env || !owner) return;
  busy = true;
  ($("sign") as HTMLButtonElement).disabled = true;
  try {
    status("Preparing and simulating the transaction…");
    const prepared: PreparedTransaction = await prepare(env.req, owner);
    status("Approve the transaction in Freighter…");
    const result = await client.signAndSend(prepared, async (xdr, ctx) => {
      const r = await signTransaction(xdr, { networkPassphrase: ctx.networkPassphrase, address: ctx.address });
      if (r.error) throw new Error(errText(r.error, "Signing was cancelled"));
      return r.signedTxXdr;
    });
    await showResult(env, result);
  } catch (e) {
    const msg = e instanceof KovanError || e instanceof Error ? e.message : String(e);
    status(plain(msg), "error");
    ($("sign") as HTMLButtonElement).disabled = false;
  } finally {
    busy = false;
  }
}

async function showResult(e: Envelope, r: SubmitResult) {
  const req = e.req;
  if (r.status !== "SUCCESS" && r.status !== "NOT_FOUND") {
    status(plain(r.error ?? `Transaction ${r.status.toLowerCase()}`), "error");
    ($("sign") as HTMLButtonElement).disabled = false;
    return;
  }
  storage(() => localStorage.setItem(DONE_KEY + location.hash, r.hash));
  $("sign").hidden = true;

  const out: Record<string, unknown> = { v: 1, fn: req.fn, status: r.status, tx: r.hash };
  if (e.id) out.id = e.id;
  if ("pool" in req) out.pool = req.pool;
  if (req.fn === "create_pool" && typeof r.returnValue === "string") out.pool = r.returnValue;
  if (req.fn === "create_agent" && typeof r.returnValue === "string") out.agent = r.returnValue;
  if ("agent" in req) out.agent = req.agent;
  if (req.fn === "create_mandate") out.mandateId = req.mandate.id;
  if (req.fn === "revoke_mandate") out.mandateId = req.mandateId;

  const links = $("links");
  links.replaceChildren();
  const tx = el("a", "View transaction") as HTMLAnchorElement;
  tx.href = explorerTx(r.hash);
  links.append(tx);
  for (const key of ["pool", "agent"] as const) {
    const id = out[key];
    if (typeof id === "string") {
      const a = el("a", `View ${key}`) as HTMLAnchorElement;
      a.href = explorerContract(id);
      links.append(a);
    }
  }
  for (const a of links.querySelectorAll("a")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  $("result-json").textContent = JSON.stringify(out);
  $("result").hidden = false;

  const pending = r.status === "NOT_FOUND"
    ? "Submitted, but the network has not confirmed it yet. Do not sign again; check the transaction link below."
    : "Done.";
  // The copy box is only for when the agent can't receive the result itself.
  if (!e.callback) {
    $("handoff").hidden = false;
    status(pending, r.status === "SUCCESS" ? "ok" : "error");
    return;
  }
  const host = new URL(e.callback).host;
  status(`${pending} Sending the result to your agent (${host})…`, "info");
  try {
    const res = await fetch(e.callback, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(out), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    status(`${pending} Your agent has the result. You can close this page.`, r.status === "SUCCESS" ? "ok" : "error");
  } catch {
    $("handoff").hidden = false;
    status(`${pending} Couldn't reach your agent at ${host}. Copy the result below and paste it to your agent.`, "error");
  }
}

async function copyResult() {
  const text = $("result-json").textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    $("copy").textContent = "Copied";
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("result-json"));
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    $("copy").textContent = "Press Ctrl+C";
  }
}

/** Plain words for the refusals an owner can hit. The technical name stays in brackets. */
const PLAIN: [RegExp, string][] = [
  [/ExceedsLocked/, "The pool doesn't have enough unassigned USDC for this draw limit. Fund the pool first, or ask for a lower limit."],
  [/Insufficient/, "That is more than the pool's unassigned USDC; funds backing agents' draw limits can't be withdrawn."],
  [/DrawnNotZero/, "The agent still holds drawn funds. Pull them back into the pool first, then close it."],
  [/BelowDrawn/, "The new draw limit is below what the agent already drew."],
  [/NotActive/, "That agent is no longer active (revoked or closed)."],
  [/PoolClosed/, "This pool is permanently closed."],
  [/TrustlineMissing/, "Your wallet can't hold USDC yet. Ask your agent for a trustline link first."],
  [/BalanceError/, "Your wallet doesn't hold enough testnet USDC for this."],
  [/Account not found|AccountMissing/, "This wallet doesn't exist on testnet yet. Fund it with testnet XLM (Freighter's \"Fund with Friendbot\") and try again."],
];

function plain(msg: string): string {
  const hit = PLAIN.find(([re]) => re.test(msg));
  return hit ? `${hit[1]} (${msg})` : msg;
}

function errText(e: unknown, fallback: string): string {
  if (typeof e === "string") return e;
  return (e as { message?: string })?.message ?? fallback;
}

function start() {
  $("connect").addEventListener("click", connect);
  $("sign").addEventListener("click", sign);
  $("copy").addEventListener("click", copyResult);
  try {
    env = parseHash(location.hash);
  } catch (e) {
    $("empty").hidden = true;
    status(e instanceof RequestError ? e.message : "This link could not be read.", "error");
    return;
  }
  if (!env) return;
  $("empty").hidden = true;
  renderRequest(env);
}

// A new request in the same tab is a new page: no state carries over.
window.addEventListener("hashchange", () => location.reload());
start();
