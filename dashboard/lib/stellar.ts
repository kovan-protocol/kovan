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

export type Ids = { pool: string; policy: string; verifier: string; usdc: string; owner: string };

/** Server-only. Env overrides win over the deployment record. */
export function ids(): Ids {
  const d = deployments();
  return {
    pool: process.env.POOL_ID ?? d.pool,
    policy: process.env.POLICY_ID ?? d.policy,
    verifier: process.env.VERIFIER_ID ?? d.verifier,
    usdc: process.env.USDC_SAC_ID ?? d.usdc,
    owner: d.owner,
  };
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
      if (!/fetch failed|ETIMEDOUT|ECONNRESET|network|socket|timeout/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const contractUrl = (id: string) => `${EXPLORER}/contract/${id}`;
