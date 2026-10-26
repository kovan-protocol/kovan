// Server-only: reads the repo's deployment record. Turbopack cannot import
// files outside the app root, so this is a runtime read, not an import.
import fs from "node:fs";
import path from "node:path";

export type Deployments = {
  network: string;
  verifier: string;
  policy: string;
  account_wasm_hash: string;
  pool: string;
  usdc: string;
  owner: string;
  first_agent?: string;
  pool_wasm_hash?: string;
  // Same policy/verifier/account/token bindings; retained for recovery after a pool-only rollout.
  legacy_pools?: { pool: string; pool_wasm_hash: string }[];
  /** Explicitly reviewed single-USDC DeFindex integrations. Empty = no activation. */
  yield_vaults?: { name: string; vault: string; wasm_hash: string; usdc: string }[];
};

export function deployments(): Deployments {
  const candidates = [
    process.env.KOVAN_DEPLOYMENTS,
    path.join(process.cwd(), "..", "deployments", "testnet.json"),
    path.join(process.cwd(), "deployments", "testnet.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as Deployments; // tiny file, re-read so redeploys are picked up
    }
  }
  throw new Error("deployments/testnet.json not found; run `make deploy` or set KOVAN_DEPLOYMENTS");
}
