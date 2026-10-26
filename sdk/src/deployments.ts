import { Buffer } from "buffer";
import { hash } from "@stellar/stellar-sdk";
import { simulateRead, type Transport } from "./transport.js";
import type { ContractConfig } from "./types.js";
import type { YieldVault } from "./defindex.js";

/** Public, reviewed artifacts. No keys or application environment access. */
export type ContractRelease = {
  policy: string; verifier: string; usdc: string;
  pool_wasm_hash: string; account_wasm_hash: string;
  mandate_version?: number;
  recovery_version?: number;
  yield_vaults?: YieldVault[];
};
export type DeploymentManifest = ContractRelease & {
  network: string; pool: string; owner: string;
  /** Latest code for NEW pools. The displayed default pool can remain historical. */
  current_release?: ContractRelease;
  /** Retained immutable releases, including user-created pools not in the address list. */
  previous_releases?: ContractRelease[];
  legacy_pools?: ({ pool: string; pool_wasm_hash: string } & Partial<ContractRelease>)[];
};
export function currentRelease(manifest: DeploymentManifest): ContractRelease {
  if (manifest.network !== "testnet") throw new Error("Kovan deployment manifest must be testnet");
  return manifest.current_release ?? manifest;
}
export function releaseContracts(release: ContractRelease): ContractConfig {
  return { policy: release.policy, verifier: release.verifier, usdc: release.usdc, poolWasmHash: release.pool_wasm_hash, accountWasmHash: release.account_wasm_hash,
    ...(release.mandate_version === 1 ? {} : { legacyBindings: true }) };
}
export function deploymentReleases(manifest: DeploymentManifest): ContractRelease[] {
  currentRelease(manifest);
  return [currentRelease(manifest), ...(manifest.previous_releases ?? []), manifest, ...(manifest.legacy_pools ?? []).map(p => ({ ...manifest, ...p }))];
}

export type PoolBindings = { policy: string; verifier: string; usdc: string; account_wasm_hash: Uint8Array; mandate_version: number };
export function assertPoolBindings(config: PoolBindings, expected: ContractConfig): void {
  if (!config || config.mandate_version !== 1 || config.policy !== expected.policy || config.verifier !== expected.verifier
      || config.usdc !== expected.usdc || !(config.account_wasm_hash instanceof Uint8Array)
      || Buffer.from(config.account_wasm_hash).toString("hex") !== expected.accountWasmHash.toLowerCase()) {
    throw new Error("Pool constructor bindings do not match the reviewed release");
  }
}
export function releaseForHash(manifest: DeploymentManifest, wasmHash: string): ContractRelease {
  const matches = deploymentReleases(manifest).filter(r => r.pool_wasm_hash.toLowerCase() === wasmHash.toLowerCase());
  if (!matches.length) throw new Error("Pool is not a Kovan pool: untrusted WASM hash");
  const distinct = new Set(matches.map(r => JSON.stringify(releaseContracts(r))));
  if (distinct.size !== 1) throw new Error("Ambiguous deployment bindings for this pool code");
  return matches[0];
}
/** Resolve even user-created historical pools by trusted code, not address alone. */
export async function resolvePoolRelease(ctx: Transport, manifest: DeploymentManifest, pool: string): Promise<ContractRelease> {
  const code = await ctx.rpc.getContractWasmByContractId(pool);
  const release = releaseForHash(manifest, hash(Buffer.from(code)).toString("hex"));
  if (release.mandate_version === 1) {
    assertPoolBindings(await simulateRead<PoolBindings>(ctx, pool, "get_config"), releaseContracts(release));
  }
  return release;
}
