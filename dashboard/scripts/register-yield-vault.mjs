// Register a wallet-created, actively invested vault. No signing or chain writes.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { jsonSafe } from "@kovan-protocol/sdk";
import { inspectYieldVault, nativeVaultFromReceipt, reviewedYieldVaults } from "@kovan-protocol/sdk/experimental";

const { values } = parseArgs({ options: { manager: { type: "string" }, "creation-tx": { type: "string" }, check: { type: "boolean" }, help: { type: "boolean" } } });
if (values.help) {
  console.log("Usage: node dashboard/scripts/register-yield-vault.mjs --manager G... --creation-tx HASH [--check]\nVerifies XOXNO vault creation and active investment, then appends to the local current-release allowlist. --check performs no writes.");
  process.exit(0);
}
try {
  assert(values.manager && values["creation-tx"], "--manager and --creation-tx are required");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const path = `${root}deployments/testnet.json`;
  const original = readFileSync(path, "utf8");
  const manifest = JSON.parse(original);
  assert.equal(manifest.network, "testnet");
  assert(manifest.current_release?.supports_yield && manifest.current_release.accounting_version >= 3, "Current release must support yield");
  const source = JSON.parse(readFileSync(`${root}deployments/candidates/xoxno-testnet.source.json`, "utf8"));
  assert.equal(source.usdc, manifest.current_release.usdc, "Source token must match the current release");
  const ctx = { rpc: new rpc.Server("https://soroban-testnet.stellar.org"), networkPassphrase: Networks.TESTNET };
  const vault = await nativeVaultFromReceipt(ctx, source, values.manager, values["creation-tx"]);
  const entry = { ...vault, name: "Kovan USDC Yield · XOXNO" };
  const state = await inspectYieldVault(ctx, entry);
  assert(state.hasActiveAllocation, "Vault is idle: activate lending in /yield/setup before registration");
  const entries = manifest.current_release.yield_vaults ?? [];
  const existing = entries.find(v => v.vault === entry.vault);
  if (existing) assert.deepEqual(existing, entry, "Conflicting existing vault entry; review rather than replace it");
  const next = { ...manifest, current_release: { ...manifest.current_release, yield_vaults: existing ? entries : [...entries, entry] } };
  reviewedYieldVaults(next, source.usdc);
  const evidence = jsonSafe({ checked_at: new Date().toISOString(), network: "testnet", manager: values.manager, creation_tx: values["creation-tx"], source, entry, state });
  if (!values.check) {
    assert.equal(readFileSync(path, "utf8"), original, "Manifest changed during verification; re-run registration");
    mkdirSync(`${root}deployments/yield`, { recursive: true });
    writeFileSync(`${root}deployments/yield/${entry.vault}.json`, JSON.stringify(evidence, null, 2) + "\n");
    const temp = `${path}.yield-${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
    renameSync(temp, path);
  }
  console.log(JSON.stringify({ ...evidence, registered: !values.check, next: "Refresh the console. Configure this vault on a new v3 pool before opening agents; sign investments or share locking in Freighter." }, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
