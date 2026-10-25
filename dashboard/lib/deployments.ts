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
};

let cached: Deployments | undefined;
export function deployments(): Deployments {
  if (cached) return cached;
  const candidates = [
    process.env.KOVAN_DEPLOYMENTS,
    path.join(process.cwd(), "..", "deployments", "testnet.json"),
    path.join(process.cwd(), "deployments", "testnet.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cached = JSON.parse(fs.readFileSync(p, "utf8")) as Deployments;
      return cached;
    }
  }
  throw new Error("deployments/testnet.json not found; run `make deploy` or set KOVAN_DEPLOYMENTS");
}
