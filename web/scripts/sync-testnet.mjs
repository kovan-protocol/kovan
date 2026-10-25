import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
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
for (const key of ["network", "verifier", "policy", "pool", "usdc", "owner", "deployed_at", "account_wasm_hash"]) {
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

function countMatches(dir, extension, pattern) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += countMatches(path, extension, pattern);
    else if (entry.name.endsWith(extension)) {
      const source = readFileSync(path, "utf8");
      total += source.match(pattern)?.length ?? 0;
    }
  }
  return total;
}

const contractsDir = join(repoRoot, "contracts");
if (existsSync(contractsDir)) {
  let counted = countMatches(contractsDir, ".rs", /#\[test\]/g);
  const dashboardTests = join(repoRoot, "dashboard", "tests");
  if (existsSync(dashboardTests)) counted += countMatches(dashboardTests, ".ts", /(?:^|\s)it(?:\.\w+)?\s*\(/gm);
  if (evidence.testCount !== counted) {
    console.error(`evidence.json testCount is ${evidence.testCount}; the repository has ${counted} tests`);
    process.exit(1);
  }
}

if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, "utf8");
  const needles = [
    deployment.pool,
    deployment.policy,
    deployment.verifier,
    deployment.usdc,
    evidence.firstAgent,
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
