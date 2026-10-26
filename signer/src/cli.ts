// kovan.mjs: Kovan on Stellar testnet, for agents.
//
// Owner actions are prepared here and signed by the person in Freighter, on a
// wallet page this tool serves on 127.0.0.1. The agent never holds the
// owner's key. Agent actions are signed with the agent's own key.
//
// Built into one file by scripts/build-cli.mjs. Do not edit the bundle.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { Keypair, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { jsonSafe, keypairTransactionSigner, type AgentAction } from "@kovan/sdk";
import deployment from "../../deployments/testnet.json";
import { client, explorerContract, explorerTx, NETWORK_PASSPHRASE, prepare } from "./chain";
import { describe, parseRequest, RequestError, usdc, type SignRequest } from "./request";

declare const __WALLET_PAGE_JS__: string;
declare const __WALLET_PAGE_CSS__: string;
declare const __KOVAN_BUNDLE__: boolean | undefined;

const HELP = `kovan.mjs - Kovan on Stellar testnet, for agents

Owner (the person signs each step in Freighter on a local page):
  connect                                  Get the person's address, proven by a signed message
  owner trustline   --owner G…             Let the wallet hold testnet USDC
  owner create_pool --owner G…             New pool owned by --owner
  owner fund        --owner G… --pool C… --amount 100
  owner create_agent --owner G… --pool C… --agent-key G… --draw-limit 40
                    [--providers G…,G… --provider-per-transfer-cap 0.5 --provider-total-cap 40]
                    [--recipients C…,G… --recipient-per-transfer-cap 1 --recipient-total-cap 5]
                    [--expiry-hours 24]
  owner revoke       --owner G… --pool C… --agent C…
  owner return_funds --owner G… --pool C… --agent C… --amount 1
  owner close        --owner G… --pool C… --agent C…
  owner withdraw     --owner G… --pool C… --amount 1

Agent (signed with the agent's own key: --key <stellar identity> or KOVAN_AGENT_SECRET):
  agent draw   --pool C… --agent C… --amount 1
  agent pay    --pool C… --agent C… --amount 0.25 --to G…
  agent return --pool C… --agent C… --amount 1

Read:
  status --pool C… [--agent C…]
  ids                                      Contract IDs this tool trusts

Wallet page: --port N (default random), --no-open, --timeout-min N (default 15)
Amounts are USDC (7 decimals). Output is one JSON line on stdout; progress on stderr.
Testnet only. Not audited.`;

const log = (msg: string) => process.stderr.write(msg + "\n");
const out = (v: unknown) => process.stdout.write(JSON.stringify(jsonSafe(v)) + "\n");

class UsageError extends Error {}

// ---------- wallet page ----------

type Job =
  | { mode: "connect"; message: string; networkPassphrase: string }
  | { mode: "sign"; xdr: string; hash: string; owner: string; networkPassphrase: string; title: string; rows: [string, string][]; notes: string[] };

type Opts = { port: number; open: boolean; timeoutMin: number };

function page(job: Job, done: string): string {
  // JSON inside <script>: escape "<" so no value can close the tag.
  const data = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Kovan wallet</title><style>${__WALLET_PAGE_CSS__}</style>
<script>(function(){var t;try{t=localStorage.getItem('kovan-theme')}catch(e){}document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'})()</script></head><body>
<header class="site-header"><div class="header-inner">
<a class="brand" href="https://kovan-indol.vercel.app" aria-label="Kovan home"><svg viewBox="0 0 401 505" aria-hidden="true"><polygon points="0,183 401,0 401,153 0,336" /><polygon points="62,350 330,229 330,505" /></svg><span>kovan</span></a>
<span class="header-label">Wallet approval</span><div class="header-controls"><span class="badge">Stellar testnet · local</span>
<button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme"><svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg><svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg></button>
</div></div></header><main>
<p class="page-kicker"><span>Agent autonomy.</span> Human control.</p><div class="approval-card">
<ol class="approval-steps" aria-label="Approval process"><li><span>01</span> Review request</li><li><span>02</span> Approve in wallet</li><li><span>03</span> Back to your agent</li></ol>
<div class="request-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg></div>
<section id="request"><p class="eyebrow">Your agent asks you to</p><h1 id="title"></h1><dl id="rows"></dl><ul id="notes" class="notes"></ul></section>
<section id="wallet"><button id="act" type="button"></button></section>
<p id="status" role="status" aria-live="polite" hidden></p>
</div><footer><p class="footer-heading">You have the final say.</p><p>This page runs on your computer, served by your agent. Trust what Freighter's own window shows: it is the real transaction. Nothing is signed without your approval there. Testnet only.</p><p class="footer-links"><a href="https://kovan-indol.vercel.app">About Kovan ↗</a><a href="https://github.com/kovan-protocol/kovan/tree/main/signer">View source ↗</a></p></footer>
</main><script>window.__KOVAN_JOB__=${data(job)};window.__KOVAN_DONE__=${data(done)};</script><script>${__WALLET_PAGE_JS__}</script></body></html>`;
}

/** Serves one job on 127.0.0.1 behind a random path. Resolves with what the page posts, once `handle` accepts it. */
function walletSession<T>(job: Job, opts: Opts, handle: (body: Record<string, unknown>) => Promise<{ result: T; message: string }>): Promise<T> {
  const token = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      const port = (server.address() as { port: number }).port;
      const origin = `http://127.0.0.1:${port}`;
      const send = (code: number, body: string, type = "application/json") => {
        res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
        res.end(body);
      };
      if (req.method === "GET" && req.url === `/${token}`) return send(200, page(job, `/${token}/done`), "text/html; charset=utf-8");
      if (req.method !== "POST" || req.url !== `/${token}/done`) return send(404, "{}");
      if (req.headers.origin !== origin || !/application\/json/.test(req.headers["content-type"] ?? "")) return send(403, JSON.stringify({ error: "Wrong origin" }));
      if (settled) return send(409, JSON.stringify({ error: "This request was already completed" }));
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 64_000) req.destroy(); });
      req.on("end", async () => {
        let body: Record<string, unknown>;
        try { body = JSON.parse(raw); } catch { return send(400, JSON.stringify({ error: "Bad JSON" })); }
        try {
          const { result, message } = await handle(body);
          settled = true;
          send(200, JSON.stringify({ message }));
          server.close();
          resolve(result);
        } catch (e) {
          send(422, JSON.stringify({ error: (e as Error).message }));
        }
      });
    });
    server.on("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/${token}`;
      log(`Open this link in the browser where Freighter is installed:\n  ${url}`);
      if (opts.open) openBrowser(url);
    });
    setTimeout(() => {
      if (settled) return;
      server.close();
      reject(new Error(`No answer from the wallet page within ${opts.timeoutMin} min`));
    }, opts.timeoutMin * 60_000).unref();
  });
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* the printed link is enough */ }
}

// ---------- commands ----------

async function connect(opts: Opts) {
  const message = `Kovan: connect this wallet (${randomBytes(6).toString("hex")})`;
  const address = await walletSession<string>({ mode: "connect", message, networkPassphrase: NETWORK_PASSPHRASE }, opts, async (body) => {
    const address = String(body.address ?? "");
    const signature = Buffer.from(String(body.signature ?? ""), "base64");
    if (!StrKey.isValidEd25519PublicKey(address)) throw new Error("Freighter returned no valid address");
    if (signature.length !== 64 || !Keypair.fromPublicKey(address).verifyMessage(message, signature)) {
      throw new Error("The signature does not match this address");
    }
    return { result: address, message: "Connected. Your agent has your address. You can close this page." };
  });
  out({ v: 1, fn: "connect", address, verified: true });
}

const OWNER_FLAGS: Record<string, string> = {
  pool: "pool", amount: "amount", agent: "agent", "agent-key": "agent_key", "draw-limit": "draw_limit",
  providers: "providers", "provider-per-transfer-cap": "provider_per_transfer_cap", "provider-total-cap": "provider_total_cap",
  recipients: "recipients", "recipient-per-transfer-cap": "recipient_per_transfer_cap", "recipient-total-cap": "recipient_total_cap",
  "expiry-hours": "expiry_hours",
};

/** Flags → the same request object the signing page accepts, so the same validation applies. */
export function ownerRequest(fn: string, flags: Record<string, string | undefined>): SignRequest {
  const obj: Record<string, unknown> = { v: 1, fn };
  for (const [flag, key] of Object.entries(OWNER_FLAGS)) {
    const v = flags[flag];
    if (v === undefined) continue;
    if (key === "providers" || key === "recipients") obj[key] = v.split(",").map((s) => s.trim()).filter(Boolean);
    else if (key === "expiry_hours") obj[key] = Number(v);
    else obj[key] = v;
  }
  return parseRequest(obj);
}

async function owner(fn: string, flags: Record<string, string | undefined>, opts: Opts) {
  const ownerAddr = flags.owner;
  if (!ownerAddr || !StrKey.isValidEd25519PublicKey(ownerAddr)) throw new UsageError("--owner G… is required (get it with: kovan.mjs connect)");
  const req = ownerRequest(fn, flags);
  log("Preparing and simulating…");
  const prepared = await prepare(req, ownerAddr);
  const s = describe(req);
  const result = await walletSession({
    mode: "sign", xdr: prepared.xdr, hash: prepared.hash, owner: ownerAddr, networkPassphrase: NETWORK_PASSPHRASE,
    title: s.title, rows: s.rows, notes: s.notes,
  }, opts, async (body) => {
    const signedXdr = String(body.signedXdr ?? "");
    if (!signedXdr) throw new Error("No signed transaction");
    // Signatures don't change the hash: anything else is a different transaction.
    if (TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE).hash().toString("hex") !== prepared.hash) {
      throw new Error("The signed transaction is not the one that was prepared");
    }
    log("Signed. Submitting…");
    const r = await client.submit(signedXdr);
    if (r.status === "FAILED" || r.status === "ERROR") throw new Error(r.error ?? `Transaction ${r.status.toLowerCase()}`);
    const msg = r.status === "SUCCESS" ? "Done. Your agent has the result. You can close this page." : "Submitted; the network has not confirmed it yet. Your agent will check. Do not sign again.";
    return { result: r, message: msg };
  });
  const res: Record<string, unknown> = { v: 1, fn, status: result.status, tx: result.hash, explorer: explorerTx(result.hash) };
  if ("pool" in req) res.pool = req.pool;
  if ("agent" in req) res.agent = req.agent;
  if (req.fn === "create_pool" && typeof result.returnValue === "string") res.pool = result.returnValue;
  if (req.fn === "create_agent" && typeof result.returnValue === "string") res.agent = result.returnValue;
  for (const k of ["pool", "agent"]) if (typeof res[k] === "string") res[`${k}_explorer`] = explorerContract(res[k] as string);
  out(res);
  if (result.status !== "SUCCESS") process.exitCode = 1;
}

function agentKeypair(flags: Record<string, string | undefined>): Keypair {
  let secret = process.env.KOVAN_AGENT_SECRET?.trim();
  if (flags.key) {
    try { secret = execFileSync("stellar", ["keys", "secret", flags.key], { encoding: "utf8" }).trim(); }
    catch { throw new UsageError(`Could not read the secret of stellar identity "${flags.key}" (stellar keys secret ${flags.key})`); }
  }
  if (!secret || !StrKey.isValidEd25519SecretSeed(secret)) throw new UsageError("Agent key needed: --key <stellar identity> or KOVAN_AGENT_SECRET=S…");
  return Keypair.fromSecret(secret);
}

async function agent(action: string, flags: Record<string, string | undefined>) {
  if (!["draw", "pay", "return"].includes(action)) throw new UsageError("agent action must be draw, pay or return");
  for (const f of ["pool", "agent", "amount"]) if (!flags[f]) throw new UsageError(`--${f} is required`);
  if (action === "pay" && !flags.to) throw new UsageError("--to is required for pay");
  const key = agentKeypair(flags);
  const signer = { publicKey: key.rawPublicKey().toString("hex"), sign: (digest: Uint8Array) => key.sign(Buffer.from(digest)) };
  const amount = usdc(flags.amount, "amount", true).toString();
  log("Preparing, signing as the agent, and simulating with the covenant…");
  const prepared = await client.pool(flags.pool!).prepareAgent(action as AgentAction, { agent: flags.agent!, amount, to: flags.to }, { source: key.publicKey(), signer });
  const r = await client.signAndSend(prepared, keypairTransactionSigner(key));
  out({ v: 1, fn: `agent_${action}`, status: r.status, tx: r.hash, explorer: explorerTx(r.hash), ...(r.error ? { error: r.error } : {}) });
  if (r.status !== "SUCCESS") process.exitCode = 1;
}

async function status(flags: Record<string, string | undefined>) {
  if (!flags.pool) throw new UsageError("--pool is required");
  const pool = client.pool(flags.pool);
  const [info, agents] = await Promise.all([pool.getPool(), pool.listAgents()]);
  const res: Record<string, unknown> = { v: 1, pool: flags.pool, ...info, agents };
  if (flags.agent) res.agent = await pool.getAgent(flags.agent);
  out(res);
}

// ---------- main ----------

export async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      owner: { type: "string" }, key: { type: "string" }, to: { type: "string" },
      port: { type: "string" }, "no-open": { type: "boolean" }, "timeout-min": { type: "string" }, help: { type: "boolean", short: "h" },
      ...Object.fromEntries(Object.keys(OWNER_FLAGS).map((f) => [f, { type: "string" as const }])),
    },
  });
  const [cmd, sub] = positionals;
  const flags = values as Record<string, string | undefined>;
  const opts: Opts = { port: Number(values.port ?? 0), open: !values["no-open"], timeoutMin: Number(values["timeout-min"] ?? 15) };
  if (values.help || !cmd || cmd === "help") return void process.stdout.write(HELP + "\n");
  switch (cmd) {
    case "connect": return connect(opts);
    case "owner": if (!sub) throw new UsageError("owner needs an action, e.g. owner fund"); return owner(sub, flags, opts);
    case "agent": if (!sub) throw new UsageError("agent needs an action: draw, pay or return"); return agent(sub, flags);
    case "status": return status(flags);
    case "ids": return out(deployment);
    default: throw new UsageError(`Unknown command "${cmd}". Run with --help.`);
  }
}

// Only the built kovan.mjs runs main(); tests import this module without side effects.
if (typeof __KOVAN_BUNDLE__ !== "undefined") {
  main(process.argv.slice(2)).catch((e) => {
    const usage = e instanceof UsageError || e instanceof RequestError || (e as { code?: string }).code?.startsWith?.("ERR_PARSE_ARGS");
    out({ v: 1, status: "ERROR", error: (e as Error).message });
    process.exitCode = usage ? 2 : 1;
  });
}
