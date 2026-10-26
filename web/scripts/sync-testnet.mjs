import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webRoot, "..");
const source = join(repoRoot, "deployments", "testnet.json");
const dest = join(webRoot, "src", "data", "testnet.json");
const readmePath = join(repoRoot, "README.md");
const evidencePath = join(webRoot, "src", "data", "evidence.json");

if (existsSync(source)) {
  copyFileSync(source, dest);
}

if (!existsSync(dest)) {
  console.error("Missing src/data/testnet.json and deployments/testnet.json");
  process.exit(1);
}

const deployment = JSON.parse(readFileSync(dest, "utf8"));
for (const key of ["network", "verifier", "policy", "pool", "usdc", "owner", "deployed_at", "account_wasm_hash", "pool_wasm_hash", "pool_deploy_tx"]) {
  if (!deployment[key]) {
    console.error("testnet.json missing", key);
    process.exit(1);
  }
}
if (deployment.network !== "testnet") {
  console.error("Refusing a non-testnet deployment record");
  process.exit(1);
}

const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));

if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  const needles = [
    deployment.pool,
    deployment.policy,
    deployment.verifier,
    deployment.usdc,
    deployment.pool_deploy_tx,
    evidence.historicalPool,
    evidence.firstAgent,
    `${evidence.testCount} tests`,
    ...evidence.transactions.map((tx) => tx.hash),
  ];
  for (const needle of needles) {
    if (!readme.includes(needle)) {
      console.error("README.md is missing evidence that the landing page shows:", needle);
      process.exit(1);
    }
  }
}

console.log("testnet evidence ok", deployment.pool);
