import type { xdr, Transaction, rpc } from "@stellar/stellar-sdk";

export type CovenantParams = {
  pool: string; usdc: string; providers: string[]; provider_per_transfer_cap: bigint; provider_total_cap: bigint;
  recipients: string[]; recipient_per_transfer_cap: bigint; recipient_total_cap: bigint;
  calls: { contract: string; fn_name: string; amount_arg: number | undefined; amount_cap: bigint }[]; expiry: number;
};
export type CovenantState = { params: CovenantParams; rule_id: number; provider_spent: bigint; recipient_spent: bigint; revoked: boolean };
export type AgentRecord = {
  covenant: CovenantParams; draw_limit: bigint; drawn: bigint; settled_spent?: bigint;
  status: string | string[]; parent: string | undefined; children: string[];
  dispute: { by: string; evidence: Uint8Array; outcome: number | undefined }[];
};
export type PoolInfo = {
  owner: string; usdc: string; locked: bigint; sum_limits: bigint; agent_count: number;
  accounting_version?: number; settled_spent?: bigint; balance?: bigint; closed?: boolean; outstanding?: bigint;
};
export type ContractConfig = { usdc: string; policy: string; verifier: string; poolWasmHash: string; accountWasmHash: string };
export type TransactionSigner = (transactionXdr: string, context: { networkPassphrase: string; address: string }) => Promise<string>;
export type DigestSigner = {
  /** Raw Ed25519 public key, 64 hex characters; never a secret. */
  publicKey: string;
  sign: (digest: Uint8Array, context: { agent: string; networkPassphrase: string; expirationLedger: number; entryXdr: string }) => Uint8Array | Promise<Uint8Array>;
};
export type RpcClient = Pick<rpc.Server, "getAccount" | "getNetwork" | "getLatestLedger" | "simulateTransaction" | "getContractWasmByContractId" | "sendTransaction" | "getTransaction">;
export type PreparedTransaction = Readonly<{
  xdr: string; hash: string; source: string; networkPassphrase: string;
  /** Simulation preview only, not a committed on-chain result. */
  preview: unknown;
}>;
export type Simulation = rpc.Api.SimulateTransactionSuccessResponse;
export type OperationInput = { source: string; operation: xdr.Operation };
export type TransactionInput = Transaction;
