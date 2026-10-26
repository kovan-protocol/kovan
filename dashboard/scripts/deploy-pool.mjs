// Testnet-only pool rollout. Never funds, closes, or migrates an existing pool.
// Historical v2-only utility. Current releases use publish-contracts.mjs and wallet-approved creation.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import dns from "node:dns";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Account, Contract, Networks, rpc, scValToNative, TransactionBuilder } from "@stellar/stellar-sdk";

dns.setDefaultResultOrder("ipv4first");
const root = fileURLToPath(new URL("../../", import.meta.url));
const file = join(root, "deployments/testnet.json");
const args = process.argv.slice(2);
assert(args.every((arg, i) => arg === "--check" || arg === "--source" || args[i - 1] === "--source"), "Unknown argument; expected --check and/or --source <identity>");
const check = args.includes("--check");
const sourceIndex = args.indexOf("--source");
const source = sourceIndex >= 0 ? args[sourceIndex + 1] : "kova-deployer";
assert(source && !source.startsWith("--"), "--source needs a Stellar CLI identity name");
const previousText = readFileSync(file, "utf8");
const previous = JSON.parse(previousText);
assert(!previous.current_release, "This historical pool-only deployer cannot publish a multi-generation release; use publish-contracts.mjs and owner wallet approval");
assert.equal(previous.network, "testnet", "Testnet only");
assert.match(previous.pool, /^C[A-Z2-7]{55}$/);
const endpoint = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(endpoint, { timeout: 20000 });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wasmDir = join(root, "contracts/target/wasm32v1-none/release");
const wasm = (name) => readFileSync(join(wasmDir, `kovan_${name}.wasm`));

async function poolInfo(pool) {
  const tx = new TransactionBuilder(new Account(previous.owner, "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(pool).call("get_pool")).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  assert(rpc.Api.isSimulationSuccess(sim), `Pool read failed: ${sim.error ?? "no result"}`);
  return scValToNative(sim.result.retval);
}

if (!check) execFileSync("make", ["build"], { cwd: root, stdio: "inherit" });
assert.equal((await server.getNetwork()).passphrase, Networks.TESTNET);
const owner = execFileSync("stellar", ["keys", "address", source], { encoding: "utf8" }).trim();
assert.equal(owner, previous.owner, "Deployment identity must match the current pool owner; use New pool for another wallet");
await server.getAccount(owner);
for (const [field, name] of [["policy", "covenant_policy"], ["verifier", "ed25519_verifier"]]) {
  assert.equal(digest(await server.getContractWasmByContractId(previous[field])), digest(wasm(name)), `${field} changed: this pool-only rollout cannot reuse it`);
}
assert.equal(digest(wasm("agent_account")), previous.account_wasm_hash, "Agent-account code changed");
assert.equal(digest(await server.getContractWasmByHash(Buffer.from(previous.account_wasm_hash, "hex"))), previous.account_wasm_hash);
assert.equal(digest(await server.getContractWasmByContractId(previous.pool)), previous.pool_wasm_hash, "Current pool does not match the deployment record");
const oldInfo = await poolInfo(previous.pool);
assert.equal(oldInfo.owner, owner);
assert.equal(oldInfo.usdc, previous.usdc);
const poolHash = digest(wasm("pool"));
console.log(`Preflight OK (testnet). Owner ${owner}; pool WASM ${poolHash}.`);
if (check) process.exit(0);

// Preserve the exact record before broadcasting, including old agent evidence.
const history = join(root, "deployments/history");
mkdirSync(history, { recursive: true });
const archive = join(history, `testnet-${previous.pool}.json`);
if (existsSync(archive)) assert.equal(readFileSync(archive, "utf8"), previousText, "Archive differs; refusing to overwrite history");
else writeFileSync(archive, previousText, { flag: "wx" });

const result = spawnSync("stellar", ["contract", "deploy", "--wasm", join(wasmDir, "kovan_pool.wasm"),
  "--source-account", source, "--rpc-url", endpoint, "--network-passphrase", Networks.TESTNET, "--",
  "--owner", owner, "--usdc", previous.usdc, "--account_wasm_hash", previous.account_wasm_hash,
  "--policy", previous.policy, "--verifier", previous.verifier], { encoding: "utf8", timeout: 180000 });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.status, 0, "Deploy failed; deployment configuration left unchanged");
const pool = result.stdout.trim();
assert.match(pool, /^C[A-Z2-7]{55}$/);
const hashes = [...result.stderr.matchAll(/Signing transaction: ([a-f0-9]{64})/g)].map((m) => m[1]);
assert(hashes.length, "No transaction hash recorded; inspect CLI output before changing configuration");
const deployHash = hashes.at(-1);
const receipt = await server.getTransaction(deployHash);
assert.equal(receipt.status, "SUCCESS", "Deploy not yet confirmed; configuration left unchanged");
assert.equal(digest(await server.getContractWasmByContractId(pool)), poolHash);
const info = await poolInfo(pool);
assert.equal(info.accounting_version, 3);
assert.equal(info.closed, false);
assert.equal(info.agent_count, 0);
assert.equal(info.balance, 0n);
assert.equal(info.owner, owner);
assert.equal(info.usdc, previous.usdc);
assert.equal(readFileSync(file, "utf8"), previousText, "Manifest changed concurrently; refusing to replace it");
const legacy = [...(previous.legacy_pools ?? []), { pool: previous.pool, pool_wasm_hash: previous.pool_wasm_hash }];
const next = {
  network: "testnet", verifier: previous.verifier, policy: previous.policy,
  account_wasm_hash: previous.account_wasm_hash, pool, pool_wasm_hash: poolHash,
  usdc: previous.usdc, owner, deployed_at: new Date(receipt.createdAt * 1000).toISOString(),
  accounting_version: 3, supports_close_pool: true, supports_yield: true, pool_deploy_tx: deployHash,
  yield_vaults: previous.yield_vaults ?? [],
  ...(hashes.length > 1 ? { pool_upload_tx: hashes[0] } : {}),
  legacy_pools: [...new Map(legacy.map((p) => [p.pool, p])).values()],
};
const temporary = `${file}.${process.pid}.tmp`;
writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
renameSync(temporary, file);
console.log(`Updated ${file}. Old funds untouched. Update README evidence, then rebuild web to sync its snapshot.`);
