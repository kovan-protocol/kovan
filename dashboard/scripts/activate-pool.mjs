// Adopt a separately wallet-approved, empty new pool as the displayed default.
// No signing or submission. Usage: node dashboard/scripts/activate-pool.mjs --pool C... --tx HEX
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";
import { Networks, rpc, StrKey } from "@stellar/stellar-sdk";
import { resolvePoolRelease, simulateRead } from "../../sdk/dist/index.js";
setDefaultResultOrder("ipv4first");
const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === "--pool" && args[2] === "--tx", "Use --pool C... --tx HEX");
const pool = args[1], tx = args[3];
assert(StrKey.isValidContract(pool)); assert.match(tx, /^[a-f0-9]{64}$/);
const path = fileURLToPath(new URL("../../deployments/testnet.json", import.meta.url));
const before = readFileSync(path, "utf8"), previous = JSON.parse(before);
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const ctx = { rpc: server, networkPassphrase: Networks.TESTNET };
assert.equal((await server.getNetwork()).passphrase, Networks.TESTNET);
const release = await resolvePoolRelease(ctx, previous, pool);
assert.equal(release.mandate_version, 1); assert.equal(release.pool_wasm_hash, previous.current_release.pool_wasm_hash);
const receipt = await server.getTransaction(tx);
assert.equal(receipt.status, "SUCCESS");
const { scValToNative, TransactionBuilder } = await import("@stellar/stellar-sdk");
assert.equal(scValToNative(receipt.returnValue), pool, "Transaction did not create this pool");
const envelope = TransactionBuilder.fromXDR(receipt.envelopeXdr.toXDR("base64"), Networks.TESTNET);
const inner = "innerTransaction" in envelope ? envelope.innerTransaction : envelope;
assert.equal(inner.source, previous.owner, "Only a wallet transaction from the original owner may replace the default");
const info = await simulateRead(ctx, pool, "get_pool");
assert.equal(info.owner, previous.owner); assert.equal(info.closed, false);
assert.equal(info.balance, 0n); assert.equal(info.agent_count, 0);
const history = fileURLToPath(new URL("../../deployments/history/", import.meta.url)); mkdirSync(history, { recursive: true });
writeFileSync(`${history}before-default-${pool}.json`, before, { flag: "wx" });
const binding = p => ({ pool: p.pool, pool_wasm_hash: p.pool_wasm_hash, policy: p.policy, verifier: p.verifier, usdc: p.usdc, account_wasm_hash: p.account_wasm_hash, mandate_version: p.mandate_version ?? 0 });
const legacy = [...(previous.legacy_pools ?? []).map(p => binding({ ...previous, ...p })), binding(previous)];
const next = { ...previous, ...release, pool, owner: info.owner, deployed_at: new Date(receipt.createdAt * 1000).toISOString(), pool_deploy_tx: tx,
  pool_upload_tx: release.transactions?.pool_upload?.tx, supports_close_pool: true,
  legacy_pools: [...new Map(legacy.map(p => [p.pool, p])).values()] };
assert.equal(readFileSync(path, "utf8"), before, "Manifest changed concurrently");
const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { flag: "wx" }); renameSync(temp, path);
console.log(`Default pool set to ${pool}; old pool bindings and funds preserved. Rebuild signer/website snapshots.`);
