// Prepare operator wallet transactions; no keys, signing, sending, or manifest writes.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { jsonSafe } from "@kovan-protocol/sdk";
import { inspectYieldVault, prepareActivateNativeVault, prepareNativeVault } from "@kovan-protocol/sdk/experimental";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  config: { type: "string" }, manager: { type: "string" }, vault: { type: "string" }, amount: { type: "string" },
  rpc: { type: "string", default: "https://soroban-testnet.stellar.org" }, help: { type: "boolean" },
} });
const usage = `Usage: node scripts/prepare-yield-vault.mjs <create|activate|inspect> --config <reviewed-source.json>
  create   --manager G... --amount <seed base units>    Create and seed atomically
  activate --manager G... --vault C... --amount <base units>  Invest idle seed
  inspect  --vault C...                               Verify allocation; emit manifest entry
Output is JSON. create/activate return unsigned XDR for the manager's wallet.
The config is a NativeYieldSource object; see docs/YIELD.md. Testnet only.`;
if (values.help) { console.log(usage); process.exit(0); }
try {
  const action = positionals[0];
  if (positionals.length !== 1 || !["create", "activate", "inspect"].includes(action) || !values.config) throw new Error(usage);
  const manifest = JSON.parse(readFileSync(new URL("../../deployments/testnet.json", import.meta.url), "utf8"));
  const source = JSON.parse(readFileSync(values.config, "utf8"));
  if (manifest.network !== "testnet" || source.usdc !== (manifest.current_release ?? manifest).usdc) throw new Error("Yield source must use Kovan's current exact testnet USDC contract");
  const ctx = { rpc: new rpc.Server(values.rpc), networkPassphrase: Networks.TESTNET };
  if (action !== "inspect" && (!values.manager || !values.amount)) throw new Error("--manager and --amount are required");
  if (action === "create") {
    const prepared = await prepareNativeVault(ctx, source, values.manager, values.amount);
    console.log(JSON.stringify(jsonSafe({ action, prepared, next: "Sign in the manager wallet. Get the committed vault address from the transaction result, then prepare activate. The simulation preview is not a deployment receipt." }), null, 2));
  } else {
    if (!values.vault) throw new Error("--vault is required");
    const vault = { name: "Kovan USDC Yield", kind: "native", vault: values.vault, wasm_hash: source.vault_wasm_hash, usdc: source.usdc, strategies: [source.strategy] };
    if (action === "activate") {
      console.log(JSON.stringify(jsonSafe({ action, prepared: await prepareActivateNativeVault(ctx, vault, values.manager, values.amount), next: "Sign in the manager wallet, then inspect the committed allocation." }), null, 2));
    } else {
      const state = await inspectYieldVault(ctx, vault);
      if (!state.hasActiveAllocation) throw new Error("Vault is not ready: seed must be invested in an active strategy before listing");
      console.log(JSON.stringify(jsonSafe({ action, state, entry: vault, next: "Review fees, strategy and lending-pool risks, then add entry to current_release.yield_vaults. Pool owners opt in with their own wallet." }), null, 2));
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
