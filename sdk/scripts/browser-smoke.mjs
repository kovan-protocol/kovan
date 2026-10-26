import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const sdk = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(sdk, "tests/browser");
const outDir = await mkdtemp(join(tmpdir(), "kovan-sdk-browser-build-"));
await build({ configFile: false, root, logLevel: "warn", build: { outDir, emptyOutDir: false } });
const server = await preview({ configFile: false, root, build: { outDir }, preview: { host: "127.0.0.1", port: 3104, strictPort: true } });
const profile = await mkdtemp(join(tmpdir(), "kovan-sdk-chromium-"));
const browser = spawn(process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser", ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9337", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { try { const v = await fn(); if (v) return v; } catch {} await delay(100); } throw new Error("Browser smoke timed out"); }
let ws;
try {
  const targets = await until(async () => (await fetch("http://127.0.0.1:9337/json/list")).json());
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener("message", ({ data }) => { const msg = JSON.parse(data); if (!msg.id) return; const call = pending.get(msg.id); pending.delete(msg.id); if (msg.error) call.reject(msg.error); else call.resolve(msg.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await call("Page.navigate", { url: "http://127.0.0.1:3104" });
  const result = await until(async () => (await call("Runtime.evaluate", { expression: "window.sdkResult", returnByValue: true })).result?.value);
  assert.equal(result.ok, true, result.error);
  console.log(result.result);
} finally {
  ws?.close(); browser.kill(); await new Promise(resolve => server.httpServer.close(resolve));
}
