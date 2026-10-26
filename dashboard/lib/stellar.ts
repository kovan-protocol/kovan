// Network, RPC and contract IDs. Testnet only.
import { Networks, rpc } from "@stellar/stellar-sdk";
import { deployments } from "./deployments";
import { currentRelease, resolvePoolRelease, type ContractRelease, type DeploymentManifest } from "@kovan-protocol/sdk";

// Node sometimes picks an unreachable IPv6 path to the RPC host; prefer IPv4.
if (typeof window === "undefined") {
  import("node:dns").then((dns) => dns.setDefaultResultOrder("ipv4first")).catch(() => {});
}

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const EXPLORER = "https://stellar.expert/explorer/testnet";

export type Ids = { pool: string; policy: string; verifier: string; usdc: string; owner: string; poolWasmHash: string; accountWasmHash: string; mandateVersion?: number };

/** Env values are strings; an empty `KEY=` in .env must not override the record. */
export const envOr = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

function binding(v: string | undefined, expected: string, name: string, multipleReleases: boolean): string {
  const selected = envOr(v, expected);
  if (multipleReleases && selected !== expected) throw new Error(`${name} conflicts with the selected pool's reviewed release; remove the global override`);
  return selected;
}

export function ids(poolOverride?: string | null): Ids {
  const d = deployments();
  if (poolOverride && !/^C[A-Z2-7]{55}$/.test(poolOverride)) throw new Error("pool must be a C… contract id");
  const pool = poolOverride || envOr(process.env.POOL_ID, d.pool);
  const cached = verifiedPools.get(pool);
  const release = cached?.manifest === JSON.stringify(d) ? cached.release
    : pool === d.pool ? d
    : d.legacy_pools?.some(p => p.pool === pool) ? { ...d, ...d.legacy_pools.find(p => p.pool === pool)! }
    : currentRelease(d as DeploymentManifest);
  return {
    pool,
    poolWasmHash: release.pool_wasm_hash ?? "",
    accountWasmHash: release.account_wasm_hash,
    policy: binding(process.env.POLICY_ID, release.policy, "POLICY_ID", !!d.current_release),
    verifier: binding(process.env.VERIFIER_ID, release.verifier, "VERIFIER_ID", !!d.current_release),
    usdc: binding(process.env.USDC_SAC_ID, release.usdc, "USDC_SAC_ID", !!d.current_release),
    mandateVersion: "mandate_version" in release ? release.mandate_version : 0,
    owner: d.owner,
  };
}

/** New deployments ALWAYS use the latest release, never the selected old pool. */
export function creationIds(): Ids {
  const d = deployments(); const release = currentRelease(d as DeploymentManifest);
  return { pool: d.pool, owner: d.owner, poolWasmHash: release.pool_wasm_hash, accountWasmHash: release.account_wasm_hash,
    policy: release.policy, verifier: release.verifier, usdc: release.usdc, mandateVersion: release.mandate_version ?? 0 };
}

export function knownPools(): string[] {
  const d = deployments();
  return [...new Set([ids().pool, d.pool, ...(d.legacy_pools ?? []).map((p) => p.pool)])];
}

const verifiedPools = new Map<string, { manifest: string; release: ContractRelease }>();
/**
 * A pool override must run current or explicitly retained legacy Kovan code.
 * Legacy code is accepted for access/recovery, never used for new deployments.
 * Stops a crafted "pool" from borrowing the fee payer's or owner's signature.
 */
export async function assertKovanPool(pool: string): Promise<void> {
  const d = deployments();
  const cached = verifiedPools.get(pool);
  const manifest = JSON.stringify(d);
  if (cached?.manifest === manifest) return;
  const release = await withRetry(() => resolvePoolRelease({ rpc: rpcServer(), networkPassphrase: NETWORK_PASSPHRASE }, d as DeploymentManifest, pool));
  verifiedPools.set(pool, { manifest, release });
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
