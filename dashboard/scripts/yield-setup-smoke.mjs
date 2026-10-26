// Browser rehearsal with intercepted APIs and an in-memory test signer. No chain writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Account, Contract, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildCreateNativeVaultOp } from "@kovan-protocol/sdk/experimental";

const root = new URL("../", import.meta.url).pathname;
const source = JSON.parse(await readFile(new URL("../../deployments/candidates/xoxno-testnet.source.json", import.meta.url), "utf8"));
const signer = Keypair.random(), manager = signer.publicKey();
const vault = "CBCTPTAL7E54BCDYO54GJUNM7GLEPL3UXAF6HEGWMM2MTXLFVJ7NCNSZ";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 120; i++) { try { if (await fn()) return; } catch { /* Navigation can replace the execution context. */ } await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3118"], { cwd: root, stdio: "ignore" });
let browser, socket;
const failures = [], submissions = [];
let prepared, creationHash, active = false;
try {
  await until(async () => { try { return (await fetch("http://127.0.0.1:3118/yield/setup")).ok; } catch { return false; } }, "server");
  const profile = await mkdtemp(join(tmpdir(), "kovan-yield-browser-"));
  browser = spawn(process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9348", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let targets;
  await until(async () => { try { targets = await (await fetch("http://127.0.0.1:9348/json/list")).json(); return targets.some(t => t.type === "page"); } catch { return false; } }, "browser");
  socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
  let id = 0; const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expression => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  socket.addEventListener("message", async ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(m.error); else p.resolve(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") failures.push(m.params.exceptionDetails.text);
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    try {
      const path = new URL(request.url).pathname;
      const body = JSON.parse(request.postData ?? "{}");
      let result;
      if (path === "/api/yield/setup" && ["create", "activate"].includes(body.action)) {
        assert.equal(body.manager, manager);
        const op = body.action === "create" ? buildCreateNativeVaultOp(source, manager, body.amount) : new Contract(vault).call("rebalance");
        const tx = new TransactionBuilder(new Account(manager, "1"), { networkPassphrase: Networks.TESTNET, fee: "100" }).addOperation(op).setTimeout(120).build();
        prepared = { xdr: tx.toXDR(), hash: tx.hash().toString("hex"), action: body.action };
        tx.sign(signer);
        await evaluate(`window.__signed = ${JSON.stringify(tx.toXDR())}`);
        result = { xdr: prepared.xdr, hash: prepared.hash };
      } else if (path === "/api/tx/submit") {
        const tx = TransactionBuilder.fromXDR(body.signedXdr, Networks.TESTNET);
        assert.equal(tx.hash().toString("hex"), prepared.hash);
        submissions.push(prepared.action);
        if (prepared.action === "create") { creationHash = prepared.hash; result = { hash: prepared.hash, status: "NOT_FOUND" }; }
        else { active = true; result = { hash: prepared.hash, status: "SUCCESS" }; }
      } else if (path === "/api/yield/setup" && body.action === "transaction") {
        assert.equal(body.hash, creationHash); result = { hash: creationHash, status: "SUCCESS", returnValue: vault };
      } else if (path === "/api/yield/setup" && body.action === "inspect") {
        assert.equal(body.creationHash, creationHash);
        result = { vault: { vault, name: "Kovan USDC Yield", wasm_hash: source.vault_wasm_hash }, enabled: false, state: { total_amount: "10000000", idle_amount: active ? "0" : "10000000", invested_amount: active ? "10000000" : "0", hasActiveAllocation: active } };
      } else throw new Error(`Unexpected API request ${path}`);
      await call("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch (e) { failures.push(e.message); await call("Fetch.failRequest", { requestId, errorReason: "Failed" }); }
  });
  await call("Runtime.enable"); await call("Page.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*" }] });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.addEventListener('message', e => {
    const m=e.data; if(m?.source!=='FREIGHTER_EXTERNAL_MSG_REQUEST') return;
    const r={source:'FREIGHTER_EXTERNAL_MSG_RESPONSE',messagedId:m.messageId};
    if(m.type==='REQUEST_ACCESS') r.publicKey=${JSON.stringify(manager)};
    if(m.type==='REQUEST_NETWORK_DETAILS') r.networkDetails={network:'TESTNET',networkPassphrase:${JSON.stringify(Networks.TESTNET)}};
    if(m.type==='SUBMIT_TRANSACTION') { if(window.__reject) { r.apiError={code:-4,message:'Wallet cancelled'}; window.__reject=false; } else { r.signedTransaction=window.__signed; r.signerAddress=${JSON.stringify(manager)}; } }
    setTimeout(()=>window.postMessage(r,location.origin),30);
  });` });
  const text = () => evaluate("document.body.innerText");
  const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const click = label => evaluate(`${button(label)}.click()`);
  const enabled = label => evaluate(`!!${button(label)} && !${button(label)}.disabled`);
  const load = async () => { await call("Page.navigate", { url: "http://127.0.0.1:3118/yield/setup" }); await until(async () => (await text()).includes("Start Kovan USDC yield"), "page"); };
  await load();
  assert.equal(await enabled("Sign to create and seed vault"), false);
  await click("Connect Freighter");
  await until(async () => (await text()).includes("Switch"), "wallet");
  await evaluate("document.querySelector('input[type=checkbox]').click(); window.__reject=true;");
  await click("Sign to create and seed vault");
  await until(async () => (await text()).includes("Wallet cancelled"), "cancelled signature");
  assert.equal(submissions.length, 0);
  await click("Sign to create and seed vault");
  await until(async () => (await text()).includes("Confirmation is unresolved"), "unknown submission");
  assert.deepEqual(submissions, ["create"]);
  await load();
  await until(async () => (await text()).includes("Check the pending creation"), "restored pending hash");
  assert.equal(await enabled("Sign to create and seed vault"), false);
  await click("Check confirmation");
  await until(async () => (await text()).includes("seeded but its funds are idle"), "confirmed idle vault");
  await click("Connect Freighter");
  await until(async () => (await text()).includes("Switch"), "reconnected wallet");
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await click("Sign to activate lending");
  await until(async () => (await text()).includes("Lending is active"), "active allocation");
  assert.deepEqual(submissions, ["create", "activate"]);
  assert.equal(await enabled("Sign to activate lending"), false);
  assert.deepEqual(failures, []);
  console.log("PASS: wallet cancellation, unknown submission recovery after reload, confirmed creation, activation and registration handoff; no chain writes.");
} finally { socket?.close(); browser?.kill(); server.kill(); }
