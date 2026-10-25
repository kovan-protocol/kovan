// Network, RPC and contract IDs. Testnet only.
import { Networks, rpc } from "@stellar/stellar-sdk";
import { deployments } from "./deployments";

// Node sometimes picks an unreachable IPv6 path to the RPC host; prefer IPv4.
if (typeof window === "undefined") {
  import("node:dns").then((dns) => dns.setDefaultResultOrder("ipv4first")).catch(() => {});
}

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const EXPLORER = "https://stellar.expert/explorer/testnet";

export type Ids = { pool: string; policy: string; verifier: string; usdc: string; owner: string; poolWasmHash: string; accountWasmHash: string };

/** Server-only. Env overrides win over the deployment record. */
/** Env values are strings; an empty `KEY=` in .env must not override the record. */
export const envOr = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

export function ids(poolOverride?: string | null): Ids {
  const d = deployments();
  if (poolOverride && !/^C[A-Z2-7]{55}$/.test(poolOverride)) throw new Error("pool must be a C… contract id");
  return {
    pool: poolOverride || envOr(process.env.POOL_ID, d.pool),
    poolWasmHash: d.pool_wasm_hash ?? "",
    accountWasmHash: d.account_wasm_hash,
    policy: envOr(process.env.POLICY_ID, d.policy),
    verifier: envOr(process.env.VERIFIER_ID, d.verifier),
    usdc: envOr(process.env.USDC_SAC_ID, d.usdc),
    owner: d.owner,
  };
}

const verifiedPools = new Set<string>();
/**
 * A pool override is only honoured if the contract runs the Kovan pool wasm.
 * Stops a crafted "pool" from borrowing the fee payer's or owner's signature.
 */
export async function assertKovanPool(pool: string): Promise<void> {
  const d = deployments();
  if (pool === d.pool || verifiedPools.has(pool)) return;
  const wasm = await withRetry(() => rpcServer().getContractWasmByContractId(pool));
  const h = (await import("node:crypto")).createHash("sha256").update(wasm).digest("hex");
  if (h !== d.pool_wasm_hash) throw new Error(`pool ${pool.slice(0, 8)}… is not a Kovan pool (wasm ${h.slice(0, 8)}…)`);
  verifiedPools.add(pool);
}

/** POST handlers are local tools; refuse cross-site and non-JSON requests. */
export function rejectCrossSite(req: Request): string | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return `cross-site request refused (${site})`;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return "origin does not match host";
  if (!/application\/json/i.test(req.headers.get("content-type") ?? "")) return "content-type must be application/json";
  return null;
}

let server: rpc.Server | undefined;
export function rpcServer(): rpc.Server {
  server ??= new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
  return server;
}

/** Retries transient transport failures (undici "fetch failed"/timeouts), not contract errors. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = (e as Error)?.message ?? "";
      if (!/fetch failed|ETIMEDOUT|ECONNRESET|network|socket|timeout|Account not found/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const contractUrl = (id: string) => `${EXPLORER}/contract/${id}`;
