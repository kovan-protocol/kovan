#!/usr/bin/env node
// Waits for the Kovan signer page to deliver one signed result, checks the
// transaction on testnet, prints the result as one JSON line, and exits.
//
//   node wait-for-result.mjs <id> [port]        (default port 8787)
//
// Put the same id and http://127.0.0.1:<port>/ as "id" and "callback" in the
// signing request. No dependencies; Node.js 18+.
import { createServer } from "node:http";

const [id, portArg = "8787"] = process.argv.slice(2);
if (!id || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
  console.error("usage: node wait-for-result.mjs <id> [port]   (id: 1-64 of A-Z a-z 0-9 . _ -)");
  process.exit(2);
}
const port = Number(portArg);
const RPC = process.env.KOVAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const ORIGINS = new Set([
  "https://kovan-protocol.github.io",
  "http://127.0.0.1:4173", "http://localhost:4173", "http://127.0.0.1:5173", "http://localhost:5173",
  ...(process.env.KOVAN_SIGNER_ORIGIN ? [process.env.KOVAN_SIGNER_ORIGIN] : []),
]);
const TIMEOUT_MIN = Number(process.env.KOVAN_WAIT_MINUTES ?? 30);

function headers(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "vary": "origin",
  };
}

async function txStatus(hash) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash } }) });
    const status = (await r.json()).result?.status;
    if (status && status !== "NOT_FOUND") return status;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return "NOT_FOUND";
}

const server = createServer((req, res) => {
  const origin = req.headers.origin ?? "";
  if (!ORIGINS.has(origin)) { res.writeHead(403).end(); return; }
  if (req.method === "OPTIONS") { res.writeHead(204, headers(origin)).end(); return; }
  if (req.method !== "POST") { res.writeHead(405, headers(origin)).end(); return; }
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
  req.on("end", async () => {
    let result;
    try { result = JSON.parse(body); } catch { res.writeHead(400, headers(origin)).end(); return; }
    if (result?.id !== id || typeof result.tx !== "string" || !/^[0-9a-f]{64}$/.test(result.tx)) {
      res.writeHead(409, headers(origin)).end("unexpected id"); // keep waiting for ours
      return;
    }
    res.writeHead(200, headers(origin)).end("ok");
    server.close();
    // Trust the chain, not the message: confirm the transaction itself.
    result.verified = await txStatus(result.tx);
    console.log(JSON.stringify(result));
    process.exit(result.verified === "SUCCESS" ? 0 : 1);
  });
});

server.listen(port, "127.0.0.1", () => console.error(`Waiting for Kovan result "${id}" on http://127.0.0.1:${port}/ (up to ${TIMEOUT_MIN} min)…`));
setTimeout(() => { console.error("Timed out waiting for the signed result."); process.exit(3); }, TIMEOUT_MIN * 60_000).unref();
