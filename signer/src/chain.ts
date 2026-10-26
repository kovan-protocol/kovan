// Turns a parsed request into a prepared transaction for the connected owner.
// Contract IDs and code hashes come from the committed deployment record, never
// from the link.
import { Asset, BASE_FEE, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { KovanClient, type OwnerArgs, type PreparedTransaction } from "@kovan/sdk";
import deployment from "../../deployments/testnet.json";
import { ledgerFromHours, type SignRequest } from "./request";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const usdcAsset = new Asset("USDC", USDC_ISSUER);

// The classic USDC asset must be the same token the pools use.
if (usdcAsset.contractId(NETWORK_PASSPHRASE) !== deployment.usdc) {
  throw new Error("Deployment USDC contract does not match the Circle testnet USDC asset");
}

export const client = new KovanClient({
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  contracts: {
    usdc: deployment.usdc,
    policy: deployment.policy,
    verifier: deployment.verifier,
    poolWasmHash: deployment.pool_wasm_hash,
    accountWasmHash: deployment.account_wasm_hash,
  },
  legacyPoolWasmHashes: (deployment.legacy_pools ?? []).map((p) => p.pool_wasm_hash),
});

/** Builds and simulates the transaction the owner will sign. */
export async function prepare(req: SignRequest, owner: string): Promise<PreparedTransaction> {
  switch (req.fn) {
    case "create_pool":
      return client.prepareCreatePool(owner);
    case "trustline": {
      const account = await client.rpc.getAccount(owner);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(Operation.changeTrust({ asset: usdcAsset }))
        .setTimeout(120)
        .build();
      return { xdr: tx.toXDR(), hash: tx.hash().toString("hex"), source: owner, networkPassphrase: NETWORK_PASSPHRASE, preview: null };
    }
    case "fund": case "withdraw":
      return client.pool(req.pool).prepareOwner(req.fn, { amount: req.amount.toString() }, owner);
    case "revoke": case "close":
      return client.pool(req.pool).prepareOwner(req.fn, { agent: req.agent, by: owner }, owner);
    case "return_funds":
      return client.pool(req.pool).prepareOwner("return_funds", { agent: req.agent, by: owner, amount: req.amount.toString() }, owner);
    case "create_agent": {
      const latest = await client.rpc.getLatestLedger();
      const args: OwnerArgs["create_agent"] = {
        agent_pubkey: req.agentPubkeyHex,
        draw_limit: req.drawLimit.toString(),
        covenant: {
          providers: req.providers,
          provider_per_transfer_cap: req.providerPerTransferCap,
          provider_total_cap: req.providerTotalCap,
          recipients: req.recipients,
          recipient_per_transfer_cap: req.recipientPerTransferCap,
          recipient_total_cap: req.recipientTotalCap,
          calls: [],
          expiry: ledgerFromHours(latest.sequence, req.expiryHours),
        },
      };
      return client.pool(req.pool).prepareOwner("create_agent", args, owner);
    }
  }
}

export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const explorerContract = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;
