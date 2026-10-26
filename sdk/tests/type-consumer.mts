import { KovanClient, type DigestSigner, type TransactionSigner, type OwnerArgs, type MandateInput, type PaymentRequest, keypairTransactionSigner, paymentIdForRequest } from "@kovan-protocol/sdk";
import { buildYieldOp } from "@kovan-protocol/sdk/experimental";
import { Keypair, Networks } from "@stellar/stellar-sdk";

declare const configuration: ConstructorParameters<typeof KovanClient>[0];
declare const address: string;
declare const agent: string;
const client = new KovanClient(configuration);
const pool = client.pool(address);
const signer: TransactionSigner = keypairTransactionSigner(Keypair.random());
const agentSigner: DigestSigner = { publicKey: "a".repeat(64), sign: async (_digest, context) => {
  const network: string = context.networkPassphrase;
  void network;
  return new Uint8Array(64);
} };
const fund: OwnerArgs["fund"] = { amount: "10000000" };
const prepared = await pool.prepareOwner("fund", fund, address);
await client.signAndSend(prepared, signer);
await pool.prepareAgent("draw", { agent, amount: "1" }, { source: address, signer: agentSigner });
const grant: MandateInput = { id: "1".repeat(64), intent_hash: "2".repeat(64), expiry: 1000, scope: { kind: "exact", asset: address, payee: address, amount: "1", reference: "3".repeat(64) } };
await pool.prepareOwner("create_mandate", { agent, params: grant }, address);
await pool.prepareOwner("revoke_mandate", { agent, id: grant.id }, address);
const payment: PaymentRequest = { mandateId: grant.id, paymentId: paymentIdForRequest("consumer_purchase_0001"), reference: "3".repeat(64) };
await pool.prepareAgent("pay", { agent, to: address, amount: "1", payment }, { source: address, signer: agentSigner });
const receipt = await pool.getPayment(agent, payment.paymentId);
const paid: bigint | undefined = receipt?.terms.amount;
void paid;
// @ts-expect-error Yield is not a stable owner method.
await pool.prepareOwner("invest", { amount: "1", min_shares: "1", valid_until: 100 }, address);
// @ts-expect-error Floating-point JavaScript amounts are not accepted.
await pool.prepareOwner("fund", { amount: 0.1 }, address);
buildYieldOp(address, "invest", { amount: "1", min_shares: "1", valid_until: 100 });
void Networks.TESTNET;
