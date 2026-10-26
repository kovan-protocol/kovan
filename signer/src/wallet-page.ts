// Browser side of the local wallet page that `kovan.mjs` serves on 127.0.0.1.
// It only talks to Freighter and posts back to the same local server. The job
// (connect, or sign one prepared transaction) comes from the server, which
// built the summary from the validated request, not from agent-written text.
import { getNetwork, isConnected, requestAccess, signMessage, signTransaction } from "@stellar/freighter-api";
import "./appearance";

type Job =
  | { mode: "connect"; message: string; networkPassphrase: string }
  | { mode: "sign"; xdr: string; hash: string; owner: string; networkPassphrase: string; title: string; rows: [string, string][]; notes: string[] };

declare global { interface Window { __KOVAN_JOB__: Job; __KOVAN_DONE__: string } }

const job = window.__KOVAN_JOB__;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
let busy = false;

function status(text: string, kind: "info" | "error" | "ok" = "info") {
  const s = $("status");
  s.textContent = text;
  s.dataset.kind = kind;
  s.hidden = !text;
}

function el(tag: string, text: string, cls?: string) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function errText(e: unknown, fallback: string): string {
  if (typeof e === "string") return e;
  return (e as { message?: string })?.message ?? fallback;
}

function toBase64(v: unknown): string {
  if (typeof v === "string") return v;
  const bytes = v instanceof Uint8Array ? v : new Uint8Array((v as { data?: number[] })?.data ?? []);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function wallet(): Promise<string> {
  const c = await isConnected();
  if (!c.isConnected) throw new Error("Freighter is not installed or is locked. Install it from freighter.app, unlock it, then try again.");
  const access = await requestAccess();
  if (access.error) throw new Error(errText(access.error, "Freighter refused access"));
  const net = await getNetwork();
  if (net.networkPassphrase !== job.networkPassphrase) throw new Error(`Freighter is on ${net.network || "another network"}. Switch it to Testnet and try again.`);
  return access.address;
}

async function finish(body: Record<string, string>) {
  const r = await fetch(window.__KOVAN_DONE__, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!r.ok) throw new Error(out.error ?? `Your agent refused the result (HTTP ${r.status})`);
  return out.message ?? "Done. Your agent has it. You can close this page.";
}

async function act() {
  if (busy) return;
  busy = true;
  const button = $("act") as HTMLButtonElement;
  button.disabled = true;
  try {
    const address = await wallet();
    if (job.mode === "connect") {
      status("Sign the message in Freighter. It proves this address is yours; it is not a transaction and moves nothing.");
      const r = await signMessage(job.message, { address, networkPassphrase: job.networkPassphrase });
      if (r.error || !r.signedMessage) throw new Error(errText(r.error, "Signing was cancelled"));
      status("Sending your address to your agent…");
      status(await finish({ address: r.signerAddress || address, signature: toBase64(r.signedMessage) }), "ok");
    } else {
      if (address !== job.owner) throw new Error(`Freighter is on ${address}. Switch it to ${job.owner}, the account this transaction was prepared for.`);
      status("Approve in Freighter. Check the contract call and amounts in Freighter's own window.");
      const r = await signTransaction(job.xdr, { networkPassphrase: job.networkPassphrase, address });
      if (r.error) throw new Error(errText(r.error, "Signing was cancelled"));
      status("Submitting to Stellar testnet…");
      status(await finish({ signedXdr: r.signedTxXdr }), "ok");
    }
    button.hidden = true;
  } catch (e) {
    status(errText(e, "Something went wrong"), "error");
    button.disabled = false;
  } finally {
    busy = false;
  }
}

function render() {
  if (job.mode === "connect") {
    $("title").textContent = "Connect your wallet";
    $("rows").append(el("dt", "What happens"), el("dd", "Freighter shares your public address with your agent and signs a short message to prove it is yours. No transaction, no fee."));
    $("act").textContent = "Connect Freighter";
  } else {
    $("title").textContent = job.title;
    for (const [k, v] of job.rows) $("rows").append(el("dt", k), el("dd", v, /^[CG][A-Z2-7]{55}/.test(v) ? "mono" : undefined));
    $("rows").append(el("dt", "Account"), el("dd", job.owner, "mono"), el("dt", "Transaction"), el("dd", job.hash, "mono"));
    $("notes").replaceChildren(...job.notes.map((n) => el("li", n)));
    $("act").textContent = "Review and sign in Freighter";
  }
  $("act").addEventListener("click", act);
}

render();
