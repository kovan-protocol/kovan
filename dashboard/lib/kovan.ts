// Dashboard-specific configuration adapter; the SDK never reads env, files or keys.
import { KovanClient } from "@kovan/sdk";
import { deployments } from "./deployments";
import { ids, NETWORK_PASSPHRASE, RPC_URL, rpcServer } from "./stellar";

export function kovanClient(pool?: string | null): KovanClient {
  const id = ids(pool);
  return new KovanClient({
    rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, rpc: rpcServer(),
    contracts: { usdc: id.usdc, policy: id.policy, verifier: id.verifier, poolWasmHash: id.poolWasmHash, accountWasmHash: id.accountWasmHash },
    legacyPoolWasmHashes: (deployments().legacy_pools ?? []).map((p) => p.pool_wasm_hash),
  });
}
