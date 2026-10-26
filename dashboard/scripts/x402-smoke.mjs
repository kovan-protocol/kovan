// Browser/API smoke with intercepted payment APIs. Never signs or submits a payment.
// Run after npm run build: node scripts/x402-smoke.mjs (Chromium required).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const origin = "http://127.0.0.1:3127";
const owner = "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC";
const pool = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
const agent = "CAL7PY3A56BEDAN4QKNR5GPKK2UGXRHXG2Y3BX3XH5OHRPWGZS6JCCLZ";
const state = {
  ids: { pool, owner, policy: pool, verifier: pool, usdc: pool }, latestLedger: 100,
  pool: { owner, usdc: pool, locked: "100000000", sum_limits: "5000000", balance: "95000000", agent_count: 1, accounting_version: 2, closed: false },
  agents: [{ id: agent, balance: "4900000", draw_limit: "5000000", drawn: "5000000", status: ["Active"], children: [], signing: { mode: "managed", publicKey: owner, exportable: false },
    covenant: { providers: [owner], recipients: [], calls: [], provider_per_transfer_cap: "2000000", provider_total_cap: "5000000", recipient_per_transfer_cap: "0", recipient_total_cap: "0", expiry: 10000 },
    state: { provider_spent: "100000", recipient_spent: "0", revoked: false, rule_id: 0 } }],
};
const payments = [];
const failures = [];
let quoteReads = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 120; i++) { try { if (await fn()) return; } catch {} await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
// Fail rather than connecting to someone else's server/debugger.
for (const port of [3127, 9357]) {
  try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); throw new Error(`Port ${port} already in use`); }
  catch (error) { if (error.message.includes("already in use")) throw error; }
}
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3127"], { cwd: root, stdio: "ignore" });
let browser, ws, profile;
try {
  await until(async () => (await fetch(origin)).ok, "server");
  // These real API calls refuse before key access or payment preparation.
  const unsafe = await fetch(`${origin}/api/x402?url=${encodeURIComponent("https://127.0.0.1/private")}`);
  assert.equal(unsafe.status, 422);
  const unreviewed = await fetch(`${origin}/api/x402`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ agent, url: "https://example.com" }) });
  assert.equal(unreviewed.status, 400, await unreviewed.text());
  const crossSite = await fetch(`${origin}/api/x402`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(crossSite.status, 403);

  profile = await mkdtemp(join(tmpdir(), "kovan-x402-browser-"));
  browser = spawn(process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9357", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let targets;
  await until(async () => { targets = await (await fetch("http://127.0.0.1:9357/json/list")).json(); return targets.some(x => x.type === "page"); }, "browser");
  ws = new WebSocket(targets.find(x => x.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let sequence = 0;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  ws.addEventListener("message", async ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p.reject(message.error); else p.resolve(message.result); return; }
    if (message.method === "Runtime.exceptionThrown") failures.push(message.params.exceptionDetails.text);
    if (message.method !== "Fetch.requestPaused") return;
    try {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      let body, status = 200;
      if (url.pathname === "/api/state") body = state;
      else if (url.pathname === "/api/events") body = { events: [], latestLedger: 100, oldestLedger: 1, truncated: false };
      else if (url.pathname === "/api/x402" && request.method === "GET") {
        quoteReads++;
        body = { url: url.searchParams.get("url"), payTo: owner, asset: pool, amount: "100000", maxTimeoutSeconds: 300, quoteId: "a".repeat(64) };
      } else if (url.pathname === "/api/x402" && request.method === "POST") {
        payments.push(JSON.parse(request.postData));
        await delay(100);
        status = 422;
        body = { ok: false, paymentStatus: "unknown", stage: "settle", error: "Unknown settlement: reconcile before a new payment" };
      } else { failures.push(url.pathname); body = { error: "Unexpected API call" }; }
      await call("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    } catch (error) { failures.push(error.message); }
  });
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });
  const evaluate = async expression => {
    const value = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
    return value.result.value;
  };
  const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const enabled = label => evaluate(`!!${button(label)} && !${button(label)}.disabled`);
  const click = label => evaluate(`${button(label)}.click()`);
  await call("Page.navigate", { url: origin });
  await until(() => enabled("Read terms"), "agent actions");
  await evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)");
  assert.equal(await enabled("Pay endpoint"), false);
  await click("Read terms");
  await until(() => enabled("Pay endpoint"), "quote reviewed");
  await evaluate(`${button("Pay endpoint")}.click(); ${button("Pay endpoint")}.click()`);
  await until(async () => (await evaluate("document.body.innerText")).includes("Unknown settlement"), "uncertain outcome");
  assert.equal(payments.length, 1, "same-tick double click must not submit twice");
  assert.equal(payments[0].pool, pool);
  assert.equal(payments[0].agent, agent);
  assert.equal(payments[0].quoteId, "a".repeat(64));
  assert.match(payments[0].requestId, /^[a-f0-9-]{36}$/);
  await click("Pay endpoint");
  await until(async () => payments.length === 2 && await enabled("Pay endpoint"), "retry same intent");
  assert.deepEqual(payments[1], payments[0], "retry must preserve quote, pool and request ID");
  assert.equal(quoteReads, 1, "retry must not silently refresh terms");
  await evaluate(`{
    const input=document.querySelector('input[id$="-mandate"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${"b".repeat(64)}');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`);
  await until(async () => !await enabled("Pay endpoint"), "mandate edit invalidates quote");
  await click("Read terms");
  await until(() => enabled("Pay endpoint"), "mandate quote reviewed");
  assert.match(await evaluate("document.body.innerText"), /On-chain payment ID: [a-f0-9]{64}/);
  await click("Pay endpoint");
  await until(async () => payments.length === 3 && await enabled("Pay endpoint"), "bound mandate request");
  assert.equal(payments[2].mandateId, "b".repeat(64));
  assert.notEqual(payments[2].requestId, payments[0].requestId);
  await click("Pay endpoint");
  await until(async () => payments.length === 4 && await enabled("Pay endpoint"), "bound mandate retry");
  assert.deepEqual(payments[3], payments[2], "mandate retry must retain its chain payment ID inputs");
  await evaluate(`{
    const input=document.querySelector('input[id$="-url"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://example.com/new');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`);
  await until(async () => !await enabled("Pay endpoint"), "URL edit invalidates quote");
  assert.deepEqual(failures, []);
  console.log("PASS local API guards, reviewed terms, selected pool, double-click prevention, stable legacy/mandate retry IDs, uncertain outcome, URL/mandate invalidation; no chain writes");
} finally {
  ws?.close();
  const stop = child => child && new Promise(resolve => { child.once("exit", resolve); child.kill(); if (child.exitCode !== null) resolve(); });
  await Promise.all([stop(browser), stop(server)]);
  // Chromium helpers can briefly flush profile files after the main process exits.
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
