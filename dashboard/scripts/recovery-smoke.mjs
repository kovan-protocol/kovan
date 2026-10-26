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
let rejectClosure = false;
let refundedAtClosure = "0";
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
      else if (path === "/api/yield/quote") {
        const q = JSON.parse(request.postData);
        const minimum = String(BigInt(q.amount) * 9950n / 10000n);
        body = { fn: q.action, pool: q.pool, vault: state.yield.vault, expected: q.amount, minimum,
          unit: q.action === "invest" ? "shares" : "USDC", validUntil: state.latestLedger + 60,
          args: q.action === "invest" ? { amount: q.amount, min_shares: minimum, valid_until: state.latestLedger + 60 }
            : { shares: q.amount, min_assets: minimum, valid_until: state.latestLedger + 60 } };
      }
      else if (path === "/api/tx/build") {
        const action = JSON.parse(request.postData);
        requests.push(action);
        if (action.fn === "close_pool" && rejectClosure) {
          await call("Runtime.evaluate", { expression: "window.__rejectSign=true" });
          rejectClosure = false;
        }
        body = { xdr: "mock-unsigned" };
      }
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
        if (action.fn === "close_pool") {
          assert.equal(state.pool.closed, false);
          assert.ok(state.agents.every(a => a.status[0] === "Closed"));
          refundedAtClosure = state.pool.balance;
          Object.assign(state.pool, { closed: true, locked: "0", balance: "0" });
          if (state.yield) Object.assign(state.yield, { shares: "0", estimated_assets: "0", budget_backing: "0" });
        }
        if (action.fn === "withdraw") {
          state.pool.balance = String(BigInt(state.pool.balance) - BigInt(action.args.amount));
          state.pool.locked = String(BigInt(state.pool.locked) - BigInt(action.args.amount));
        }
        if (action.fn === "configure_yield") state.yield.vault = action.args.vault;
        if (["invest", "lock_shares", "redeem_shares", "release_shares"].includes(action.fn)) {
          const amount = BigInt(action.args.amount ?? action.args.shares);
          const add = (n, delta) => String(BigInt(n) + delta);
          if (action.fn === "invest") state.pool.balance = add(state.pool.balance, -amount);
          if (action.fn === "redeem_shares") state.pool.balance = add(state.pool.balance, amount);
          state.yield.shares = add(state.yield.shares, ["invest", "lock_shares"].includes(action.fn) ? amount : -amount);
          state.yield.estimated_assets = state.yield.shares;
          state.yield.budget_backing = String(BigInt(state.yield.shares) * 9n / 10n);
          state.pool.locked = add(state.pool.balance, BigInt(state.yield.budget_backing));
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
    await until(async () => (await text()).includes("Close pool & return funds"), "state rendered");
  }
  await load();
  assert.equal(await enabled("Recover funds"), false);
  assert.equal(await enabled("Return to wallet"), false);
  await evaluate(`window.__walletAddress='GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'`);
  await click("Connect Freighter");
  await until(async () => (await text()).includes("not the pool owner"), "non-owner");
  assert.equal(await enabled("Recover funds"), false);
  await evaluate(`window.__walletAddress=${JSON.stringify(owner)}`);
  await click("Switch");
  await until(() => enabled("Recover funds"), "owner connected");
  assert.equal(await enabled("Close pool"), false, "old contracts cannot be shut down");
  assert.match(await text(), /no permanent shutdown function/);
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
  await click("Recover funds");
  assert.match(await text(), /Legacy pool/);
  assert.match(await text(), /Payments already made cannot be recovered/);
  assert.equal(requests.length, 0, "opening confirmation does not sign");
  await click("Cancel");
  assert.equal(await evaluate(`document.activeElement===${button("Recover funds")}`), true);
  await click("Recover funds");
  await evaluate("window.__rejectSign=true; window.__signDelay=800");
  await click("Confirm recovery");
  await until(async () => requests.length > 0, "first transaction built");
  assert.equal(await enabled("Switch"), false);
  assert.equal(await enabled("Pay endpoint"), false);
  assert.equal(await enabled("Return to wallet"), false);
  assert.equal(await evaluate("document.querySelector('#pool-select').disabled"), true);
  await until(async () => (await text()).includes("Test signature rejected"), "rejection visible");
  assert.equal(submitted.length, 0);
  assert.equal(requests.length, 1);
  await until(() => enabled("Confirm recovery"), "retry enabled");
  await evaluate("window.__signDelay=50");
  await click("Confirm recovery");
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
  await until(() => enabled("Recover funds"), "V2 owner");
  await click("Recover funds");
  await click("Confirm recovery");
  await until(async () => (await text()).includes("Agents closed and unspent funds recovered"), "V2 recovery complete");
  assert.deepEqual(submitted.map(a => a.fn), ["revoke", "close"]);
  assert.equal(await enabled("Recover funds"), false);
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

  // New lifecycle: close agents, then atomically shut down and refund the pool.
  state = initial(false);
  state.pool.closed = false;
  submitted.length = 0;
  rejectClosure = true;
  await load();
  await click("Connect Freighter");
  await until(() => enabled("Close pool"), "shutdown-capable owner");
  await click("Close pool");
  assert.match(await text(), /The pool cannot be reopened/);
  assert.match(await text(), /final transaction returns all remaining pool USDC/);
  await click("Confirm permanent closure");
  await until(async () => (await text()).includes("Test signature rejected"), "final signature rejected");
  assert.deepEqual(submitted.map(a => a.fn), ["revoke", "close"]);
  assert.equal(state.pool.closed, false, "cancellation must not claim shutdown");
  assert.equal(state.pool.balance, "99900000");
  await until(() => enabled("Confirm permanent closure"), "closure retry");
  await click("Confirm permanent closure");
  await until(async () => (await text()).includes("Pool permanently closed."), "pool shutdown complete");
  assert.deepEqual(submitted.map(a => a.fn), ["revoke", "close", "close_pool"]);
  assert.equal(refundedAtClosure, "99900000");
  assert.equal(submitted.at(-1).source, owner);
  assert.equal(submitted.at(-1).pool, pool);
  assert.deepEqual(submitted.at(-1).args, {});
  assert.equal(state.pool.closed, true);
  assert.equal(state.pool.balance, "0");
  assert.equal(await enabled("Close pool"), false);
  assert.equal(await enabled("Fund"), false);
  assert.equal(await enabled("Create agent"), false);
  assert.equal(await enabled("Return to wallet"), false);
  assert.equal(await enabled("New pool"), true);
  await load();
  await click("Connect Freighter");
  await until(() => enabled("New pool"), "closed pool reloaded");
  assert.match(await text(), /Permanently closed/);
  assert.equal(await enabled("Fund"), false);
  assert.equal(await enabled("Create agent"), false);
  // Late deposits must remain recoverable without reopening the pool.
  state.pool.balance = "10000";
  state.pool.locked = "10000";
  await click("Refresh");
  await until(() => enabled("Return to wallet"), "late refund");
  await click("Return to wallet");
  await click("Confirm return to wallet");
  await until(async () => state.pool.balance === "0", "late refund withdrawn");
  assert.equal(state.pool.closed, true);
  assert.equal(submitted.at(-1).fn, "withdraw");

  state = initial(false);
  state.pool.closed = false;
  state.agents = [];
  Object.assign(state.pool, { balance: "0", locked: "0", sum_limits: "0", agent_count: 0 });
  await load();
  await click("Connect Freighter");
  await until(() => enabled("Close pool"), "empty pool can still be closed");
  await click("Close pool");
  for (const width of [375, 768, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `closure overflow at ${width}`);
  }
  await click("Confirm permanent closure");
  await until(async () => state.pool.closed, "empty pool closed");

  // Yield v3 UI: explicit opt-in, both funding paths, preview/rejection/retry,
  // redemption into pool cash, and in-kind recovery. Never calls real provider APIs.
  state = initial(false);
  state.agents = [];
  Object.assign(state.pool, { accounting_version: 3, closed: false, outstanding: "0", balance: "100000000", locked: "100000000", sum_limits: "0", agent_count: 0 });
  state.yield = { vault: null, shares: "0", share_balance_ok: true, share_decimals: 7, estimated_assets: "0", budget_backing: "0", backing_bps: 9000, valuation_ok: true };
  state.yieldVaults = [];
  submitted.length = 0;
  await load();
  assert.match(await text(), /No testnet vault is enabled yet/);
  state.yieldVaults = [
    { name: "Mocked external vault", kind: "external", vault: agent, usdc: pool, wasm_hash: "a".repeat(64) },
    { name: "Mocked Kovan vault", kind: "native", vault: pool, usdc: pool, wasm_hash: "b".repeat(64) },
  ];
  await click("Refresh");
  await until(async () => (await text()).includes("Sign to enable vault"), "yield activation renders");
  assert.equal(await enabled("Sign to enable vault"), false);
  await click("Connect Freighter");
  await until(() => enabled("New pool"), "yield owner connected");
  const acknowledgeRisk = () => evaluate(`document.querySelector('section[aria-labelledby="yield-title"] input[type="checkbox"]').click()`);
  assert.equal(await enabled("Sign to enable vault"), false, "risk acknowledgement required");
  assert.equal(await evaluate("document.querySelector('#yield-vault').value"), pool, "prefer native yield when available");
  await acknowledgeRisk();
  await evaluate(`document.querySelector('#yield-vault').value=${JSON.stringify(agent)}; document.querySelector('#yield-vault').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await enabled("Sign to enable vault"), false, "changing vault clears consent");
  await acknowledgeRisk();
  await click("Sign to enable vault");
  await until(() => enabled("Preview transaction"), "configured yield controls");
  assert.equal(submitted.at(-1).fn, "configure_yield");
  assert.equal(submitted.at(-1).args.vault, agent, "binds the selected external vault");
  await click("Preview transaction");
  await until(async () => (await text()).includes("Minimum received"), "investment preview");
  assert.equal(await enabled("Sign invest pool usdc"), false);
  assert.equal(submitted.length, 1, "preview must not broadcast");
  await acknowledgeRisk();
  await evaluate("window.__rejectSign=true");
  await click("Sign invest pool usdc");
  await until(async () => (await text()).includes("Test signature rejected"), "yield rejection");
  assert.equal(submitted.length, 1);
  await until(() => enabled("Sign invest pool usdc"), "yield retry");
  await click("Sign invest pool usdc");
  await until(async () => state.yield.shares === "10000000" && (await text()).includes("Invest pool USDC confirmed"), "invested");
  assert.equal(submitted.at(-1).args.min_shares, "9950000");
  const changeYieldAction = value => evaluate(`{
    const input=document.querySelector('#yield-action');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }`);
  await changeYieldAction("lock_shares");
  await click("Preview transaction");
  await until(async () => (await text()).includes("Minimum position value"), "lock preview");
  await acknowledgeRisk();
  for (const width of [375, 768, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `yield overflow at ${width}`);
  }
  assert.equal(await evaluate("document.querySelector('#yield-amount').labels.length > 0 && document.querySelector('#yield-action').labels.length > 0"), true);
  await click("Sign lock existing shares");
  await until(async () => state.yield.shares === "20000000" && (await text()).includes("Lock existing shares confirmed"), "locked");
  assert.equal(state.pool.balance, "90000000", "locking shares does not move underlying cash");
  await changeYieldAction("redeem_shares");
  await click("Preview transaction");
  await until(() => enabled("Sign redeem shares to pool"), "redeem preview");
  await click("Sign redeem shares to pool");
  await until(async () => state.pool.balance === "100000000" && (await text()).includes("Redeem shares to pool confirmed"), "redeemed to pool");
  await click("Sign return of all shares");
  await until(async () => state.yield.shares === "0" && (await text()).includes("Return vault shares to owner confirmed"), "shares returned");
  assert.deepEqual(submitted.map(a => a.fn), ["configure_yield", "invest", "lock_shares", "redeem_shares", "release_shares"]);
  assert.ok(submitted.every(a => a.source === owner && a.pool === pool));
  assert.deepEqual(failures, []);
  console.log("PASS: covenant guidance, owner gating, legacy/V2 recovery and closure, rejection/retry, late refunds, yield opt-in and both funding paths, protected previews, redemption and in-kind recovery, busy guards, and 375/768/1280px layouts. All APIs and wallet signatures mocked; no transactions sent.");
} finally {
  ws?.close();
  browser?.kill("SIGTERM");
  server.kill("SIGTERM");
}
