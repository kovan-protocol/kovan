// Native mandate v1, against a matching deployment and already-funded new agent.
// Importing this module does nothing. Persist IDs and all inputs BEFORE calling.
// Never automatically rerun the workflow after an unknown submission outcome.
import { paymentIdForRequest } from "@kovan-protocol/sdk";

export async function approveAndPay({
  client, poolAddress, agent, asset, payee, amount, intentHash, referenceHash,
  mandateId, requestId, expiryLedger,
  ownerAddress, ownerSigner, feePayerAddress, feeSigner, agentSigner,
}) {
  const pool = client.pool(poolAddress);
  const paymentId = paymentIdForRequest(requestId);
  const grant = await pool.prepareOwner("create_mandate", {
    agent,
    params: {
      id: mandateId, intent_hash: intentHash, expiry: expiryLedger,
      scope: { kind: "exact", asset, payee, amount, reference: referenceHash },
    },
  }, ownerAddress);
  const approved = await client.signAndSend(grant, ownerSigner);
  if (approved.status !== "SUCCESS") {
    throw new Error(`Mandate approval not confirmed: ${approved.hash}. Reconcile before continuing.`);
  }
  const payment = await pool.prepareAgent("pay", {
    agent, to: payee, amount,
    payment: { mandateId, paymentId, reference: referenceHash },
  }, { source: feePayerAddress, signer: agentSigner });
  const settled = await client.signAndSend(payment, feeSigner);
  if (settled.status !== "SUCCESS") {
    throw new Error(`Payment not confirmed: ${settled.hash}; payment ID ${paymentId}. Reconcile; do not create another ID.`);
  }
  const receipt = await pool.getPayment(agent, paymentId);
  if (!receipt) throw new Error(`Missing receipt for ${paymentId}; reconcile transaction ${settled.hash}.`);
  return { grantHash: approved.hash, paymentHash: settled.hash, mandateId, paymentId, receipt };
}
