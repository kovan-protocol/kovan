// Dashboard-specific configuration adapter; the SDK never reads env, files or keys.
import { KovanClient } from "@kovan-protocol/sdk";
import { assertKovanPool, ids, NETWORK_PASSPHRASE, RPC_URL, rpcServer } from "./stellar";

export async function kovanClient(pool?: string | null): Promise<KovanClient> {
  await assertKovanPool(ids(pool).pool);
  const id = ids(pool);
  return new KovanClient({
    rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, rpc: rpcServer(),
    contracts: { usdc: id.usdc, policy: id.policy, verifier: id.verifier, poolWasmHash: id.poolWasmHash, accountWasmHash: id.accountWasmHash },
  });
}
