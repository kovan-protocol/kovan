// Publish a testnet release WITHOUT signing any owner's pool/funding actions.
// Usage: node dashboard/scripts/publish-contracts.mjs --source <dedicated-deployer> [--check]
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { simulateRead } from "../../sdk/dist/index.js";

setDefaultResultOrder("ipv4first");
const args = process.argv.slice(2);
assert(args.every((a, i) => a === "--check" || a === "--source" || args[i - 1] === "--source"), "Use --check and/or --source <dedicated identity>");
const source = args.includes("--source") ? args[args.indexOf("--source") + 1] : undefined;
assert(source && /^[A-Za-z0-9_-]{1,80}$/.test(source), "A dedicated --source identity is required (never an owner's secret)");
const root = fileURLToPath(new URL("../../", import.meta.url));
const path = join(root, "deployments/testnet.json");
const previousText = readFileSync(path, "utf8");
const previous = JSON.parse(previousText);
assert.equal(previous.network, "testnet");
const endpoint = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(endpoint, { timeout: 20000 });
const context = { rpc: server, networkPassphrase: Networks.TESTNET };
assert.equal((await server.getNetwork()).passphrase, Networks.TESTNET);
console.log("Network", JSON.stringify(await server.getVersionInfo()));
const deployer = execFileSync("stellar", ["keys", "address", source], { encoding: "utf8" }).trim();
assert.notEqual(deployer, previous.owner, "Use a separate testnet deployer; owner actions belong in the wallet");
await server.getAccount(deployer);
const wasmDir = join(root, "contracts/target/wasm32v1-none/release");
const wasmPath = name => join(wasmDir, `kovan_${name}.wasm`);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const hashes = Object.fromEntries(["pool", "agent_account", "covenant_policy", "ed25519_verifier"].map(name => [name, digest(readFileSync(wasmPath(name)))]));
assert.equal(digest(await server.getContractWasmByContractId(previous.verifier)), hashes.ed25519_verifier, "Verifier changed: review a separate verifier rollout");
console.log(JSON.stringify({ deployer, hashes, defaultPoolUnchanged: previous.pool }));
if (args.includes("--check")) process.exit(0);

const history = join(root, "deployments/history");
mkdirSync(history, { recursive: true });
const archive = join(history, `testnet-before-mandates-${digest(Buffer.from(previousText)).slice(0, 16)}.json`);
if (!existsSync(archive)) writeFileSync(archive, previousText, { flag: "wx" });
else assert.equal(readFileSync(archive, "utf8"), previousText);
const journalPath = join(root, `deployments/mandate-release-${hashes.pool.slice(0, 16)}.json`);
const journal = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, "utf8")) : { deployer, hashes, steps: {} };
assert.equal(journal.deployer, deployer); assert.deepEqual(journal.hashes, hashes);
function save() {
  const temp = `${journalPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(journal, null, 2) + "\n", { flag: "wx" }); renameSync(temp, journalPath);
}
async function broadcast(name, command) {
  if (journal.steps[name]) {
    assert(!journal.steps[name].pending, `Interrupted ${name}: reconcile the CLI transaction before resuming`);
    assert.equal((await server.getTransaction(journal.steps[name].tx)).status, "SUCCESS", "Previous transaction is not confirmed in RPC history; reconcile manually");
    return journal.steps[name].value;
  }
  journal.steps[name] = { pending: true }; save();
  const result = spawnSync("stellar", [...command, "--source-account", source, "--rpc-url", endpoint, "--network-passphrase", Networks.TESTNET], { encoding: "utf8", timeout: 180000 });
  process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
  assert.equal(result.status, 0, `${name} interrupted/failed: reconcile before retrying; manifest unchanged`);
  const txs = [...result.stderr.matchAll(/Signing transaction: ([a-f0-9]{64})/g)].map(m => m[1]);
  assert(txs.length, "Missing transaction hash; inspect CLI output before retrying");
  const tx = txs.at(-1);
  assert.equal((await server.getTransaction(tx)).status, "SUCCESS", "Transaction not confirmed; reconcile before retrying");
  journal.steps[name] = { value: result.stdout.trim(), tx, transactions: txs }; save();
  return journal.steps[name].value;
}
const accountHash = await broadcast("account_upload", ["contract", "upload", "--wasm", wasmPath("agent_account")]);
assert.equal(accountHash, hashes.agent_account);
const poolHash = await broadcast("pool_upload", ["contract", "upload", "--wasm", wasmPath("pool")]);
assert.equal(poolHash, hashes.pool);
const policy = await broadcast("policy_deploy", ["contract", "deploy", "--wasm", wasmPath("covenant_policy")]);
assert.match(policy, /^C[A-Z2-7]{55}$/);
assert.equal(digest(await server.getContractWasmByContractId(policy)), hashes.covenant_policy);
assert.equal(await simulateRead(context, policy, "mandate_version"), 1);
for (const h of [accountHash, poolHash]) assert.equal(digest(await server.getContractWasmByHash(Buffer.from(h, "hex"))), h);
assert.equal(readFileSync(path, "utf8"), previousText, "Manifest changed concurrently; published code preserved in journal, no overwrite");
const release = { name: "native-mandates-v1", mandate_version: 1, accounting_version: 3,
  policy, verifier: previous.verifier, usdc: previous.usdc, account_wasm_hash: accountHash, pool_wasm_hash: poolHash,
  policy_wasm_hash: hashes.covenant_policy, verifier_wasm_hash: hashes.ed25519_verifier,
  published_at: new Date().toISOString(), deployer, transactions: journal.steps,
  supports_yield: true, yield_vaults: [],
};
const next = { ...previous, current_release: release };
const temp = `${path}.${process.pid}.tmp`;
writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { flag: "wx" }); renameSync(temp, path);
console.log(JSON.stringify({ published: release, defaultPoolUnchanged: previous.pool, next: "Owner creates a new pool in Freighter. No existing pools, agents or funds were modified." }, null, 2));
