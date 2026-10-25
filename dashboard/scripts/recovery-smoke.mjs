// Browser smoke test with intercepted APIs and a fake Freighter bridge. No chain writes.
// Run after npm run build: node scripts/recovery-smoke.mjs (Chromium required).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const owner = "GCNN4XIU3KU3QA6B3ENL752Q4J6ZBPOERRT54WV2P2N7GBLHCBNMHBOC";
const pool = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
const agent = "CAL7PY3A56BEDAN4QKNR5GPKK2UGXRHXG2Y3BX3XH5OHRPWGZS6JCCLZ";
function initial(legacy = true) {
  return {
    ids: { pool, owner, policy: pool, verifier: pool, usdc: pool }, latestLedger: 100,
    pool: { owner, usdc: pool, locked: "100000000", sum_limits: "5000000", balance: "95000000", agent_count: 1, ...(legacy ? {} : { accounting_version: 2 }) },
    agents: [{ id: agent, balance: "4900000", draw_limit: "5000000", drawn: "5000000", status: ["Active"], children: [],
      signing: { mode: "managed", publicKey: owner, exportable: false },
      covenant: { providers: [owner], recipients: [], calls: [], provider_per_transfer_cap: "2000000", provider_total_cap: "5000000", recipient_per_transfer_cap: "0", recipient_total_cap: "0", expiry: 10000 },
      state: { provider_spent: "100000", recipient_spent: "0", revoked: false, rule_id: 0 } }],
  };
}
let state = initial();
const requests = [];
const submitted = [];
const failures = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label) {
  for (let n = 0; n < 120; n++) { try { const r = await fn(); if (r) return r; } catch {} await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3103"], { cwd: root, stdio: "ignore" });
let browser, ws;
try {
  await until(async () => (await fetch("http://127.0.0.1:3103")).ok, "server");
  const profile = await mkdtemp(join(tmpdir(), "kovan-recovery-browser-"));
  browser = spawn(process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9336", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const targets = await until(async () => await (await fetch("http://127.0.0.1:9336/json/list")).json(), "browser");
  ws = new WebSocket(targets.find(x => x.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  function call(method, params = {}) {
    return new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  }
  ws.addEventListener("message", async ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(m.error);
      else p.resolve(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") failures.push(m.params.exceptionDetails.text);
    if (m.method !== "Fetch.requestPaused") return;
    try {
      const { requestId, request } = m.params;
      const path = new URL(request.url).pathname;
      let body;
      if (path === "/api/state") body = state;
      else if (path === "/api/events") body = { events: [], latestLedger: 100, oldestLedger: 1, truncated: false };
      else if (path === "/api/tx/build") { requests.push(JSON.parse(request.postData)); body = { xdr: "mock-unsigned" }; }
      else if (path === "/api/tx/submit") {
        const action = requests.at(-1);
        submitted.push(action);
        const a = state.agents[0];
        if (action.fn === "revoke") { a.status = ["Revoked"]; a.state.revoked = true; }
        if (action.fn === "return_funds") {
          a.balance = "0"; a.drawn = "100000"; state.pool.balance = "99900000";
        }
        if (action.fn === "amend") {
          a.draw_limit = action.args.draw_limit; state.pool.sum_limits = action.args.draw_limit;
        }
        if (action.fn === "close") {
          a.status = ["Closed"]; a.drawn = "0"; a.balance = "0";
          Object.assign(state.pool, { sum_limits: "0", locked: "99900000", balance: "99900000" });
        }
        if (action.fn === "withdraw") {
          state.pool.balance = String(BigInt(state.pool.balance) - BigInt(action.args.amount));
          state.pool.locked = String(BigInt(state.pool.locked) - BigInt(action.args.amount));
        }
        body = { status: "SUCCESS", hash: `mock-hash-${submitted.length}` };
      } else { body = { error: "Unexpected mocked API request" }; failures.push(path); }
      await call("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    } catch (e) { failures.push(e.message); }
  });
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__walletAddress=${JSON.stringify(owner)};
    window.__signDelay=50;
    window.addEventListener('message',e=>{
      const m=e.data;
      if(m?.source!=='FREIGHTER_EXTERNAL_MSG_REQUEST') return;
      const response={source:'FREIGHTER_EXTERNAL_MSG_RESPONSE',messagedId:m.messageId};
      if(m.type==='REQUEST_ACCESS') response.publicKey=window.__walletAddress;
      if(m.type==='REQUEST_NETWORK_DETAILS') response.networkDetails={network:'TESTNET',networkPassphrase:'Test SDF Network ; September 2015'};
      if(m.type==='SUBMIT_TRANSACTION') {
        if(window.__rejectSign) { response.apiError={code:-4,message:'Test signature rejected'}; window.__rejectSign=false; }
        else { response.signedTransaction='mock-signed'; response.signerAddress=window.__walletAddress; }
      }
      setTimeout(()=>window.postMessage(response,location.origin),m.type==='SUBMIT_TRANSACTION'?window.__signDelay:50);
    });` });
  const evaluate = async expression => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const click = label => evaluate(`${button(label)}.click()`);
  const enabled = label => evaluate(`!!${button(label)} && !${button(label)}.disabled`);
  const text = () => evaluate("document.body.innerText");
  async function load() {
    await call("Page.navigate", { url: "http://127.0.0.1:3103" });
    await until(async () => (await text()).includes("Free pool & return funds"), "state rendered");
  }
  await load();
  assert.equal(await enabled("Free pool"), false);
  assert.equal(await enabled("Return to wallet"), false);
  await evaluate(`window.__walletAddress='GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'`);
  await click("Connect Freighter");
  await until(async () => (await text()).includes("not the pool owner"), "non-owner");
  assert.equal(await enabled("Free pool"), false);
  await evaluate(`window.__walletAddress=${JSON.stringify(owner)}`);
  await click("Switch");
  await until(() => enabled("Free pool"), "owner connected");
  // Guided covenant fields must not overwrite input or submit a transaction.
  await evaluate(`document.querySelectorAll('details').forEach(d=>d.open=true)`);
  const value = suffix => evaluate(`document.querySelector('[id$="-${suffix}"]').value`);
  const setValue = (suffix, value) => evaluate(`{
    const input=document.querySelector('[id$="-${suffix}"]');
    const prototype=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`);
  const demoPayee = "GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W";
  await setValue("prov", owner);
  await setValue("ppt", "0.07");
  await setValue("pt", "0.40");
  await click("Add demo payee");
  await click("Add demo payee");
  assert.equal(await value("prov"), `${owner}\n${demoPayee}`);
  assert.equal(await value("ppt"), "0.07");
  assert.equal(await value("pt"), "0.40");
  await click("Add pool owner");
  await click("Add pool owner");
  assert.equal(await value("rec"), owner);
  assert.equal(await value("rpt"), "");
  assert.equal(await value("rt"), "");
  await click("Add call rule");
  assert.match(await text(), /No amount check selected/);
  assert.match(await text(), /Cumulative, not daily/);
  assert.match(await text(), /1,000,000 raw units/);
  for (const name of ["contract", "function", "index", "cap"]) {
    assert.equal(await evaluate(`{
      const input=document.querySelector('[id$="-call-0-${name}"]');
      !!input.labels?.length && !!document.getElementById(input.getAttribute('aria-describedby'));
    }`), true);
  }
  await setValue("call-0-index", "1");
  await setValue("call-0-cap", "0.10");
  assert.doesNotMatch(await text(), /No amount check selected/);
  for (const width of [375, 768, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `form overflow at ${width}`);
  }
  await click("Remove rule");
  assert.match(await text(), /No additional calls allowed/);
  assert.equal(requests.length, 0, "examples and call rules must not sign or submit");
  await click("Free pool");
  assert.match(await text(), /Legacy pool/);
  assert.match(await text(), /Payments already made cannot be recovered/);
  assert.equal(requests.length, 0, "opening confirmation does not sign");
  await click("Cancel");
  assert.equal(await evaluate(`document.activeElement===${button("Free pool")}`), true);
  await click("Free pool");
  await evaluate("window.__rejectSign=true; window.__signDelay=800");
  await click("Confirm free pool");
  await until(async () => requests.length > 0, "first transaction built");
  assert.equal(await enabled("Switch"), false);
  assert.equal(await enabled("Pay endpoint"), false);
  assert.equal(await enabled("Return to wallet"), false);
  assert.equal(await evaluate("document.querySelector('#pool-select').disabled"), true);
  await until(async () => (await text()).includes("Test signature rejected"), "rejection visible");
  assert.equal(submitted.length, 0);
  assert.equal(requests.length, 1);
  await until(() => enabled("Confirm free pool"), "retry enabled");
  await evaluate("window.__signDelay=50");
  await click("Confirm free pool");
  await until(async () => (await text()).includes("legacy allocation(s) remain revoked"), "legacy recovery complete");
  assert.deepEqual(submitted.map(a => a.fn), ["revoke", "return_funds", "amend"]);
  assert.equal(submitted[1].args.amount, "4900000");
  assert.equal(submitted[2].args.draw_limit, "100000");
  assert.equal(state.pool.balance, "99900000");
  await click("Return to wallet");
  assert.match(await text(), /9\.99 USDC/);
  assert.match(await text(), new RegExp(owner));
  await click("Confirm return to wallet");
  await until(async () => (await text()).includes("Available USDC returned"), "withdrawal complete");
  assert.deepEqual(submitted.at(-1).args, { amount: "99900000" });
  assert.equal(submitted.at(-1).source, owner);
  assert.equal(submitted.at(-1).pool, pool);
  assert.equal(state.pool.balance, "0");
  assert.equal(await enabled("Return to wallet"), false);

  state = initial(false);
  submitted.length = 0;
  await load();
  await click("Connect Freighter");
  await until(() => enabled("Free pool"), "V2 owner");
  await click("Free pool");
  await click("Confirm free pool");
  await until(async () => (await text()).includes("Agents closed and unspent funds recovered"), "V2 recovery complete");
  assert.deepEqual(submitted.map(a => a.fn), ["revoke", "close"]);
  assert.equal(await enabled("Free pool"), false);
  await click("Return to wallet");
  for (const width of [375, 768, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `overflow at ${width}`);
  }
  await evaluate(`${button("Cancel")}.focus()`);
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate(`document.activeElement===${button("Return to wallet")}`), true);
  assert.equal(await enabled("Confirm return to wallet"), false);
  assert.deepEqual(failures, []);
  console.log("PASS: guided covenant examples, input preservation, labeled call rules, owner gating, confirmation/cancel/Escape, rejected signature/retry, legacy and V2 recovery, exact owner withdrawal, busy-state guards, and 375/768/1280px layouts. All APIs and wallet signatures mocked; no transactions sent.");
} finally {
  ws?.close();
  browser?.kill("SIGTERM");
  server.kill("SIGTERM");
}
