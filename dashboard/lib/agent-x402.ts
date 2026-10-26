// Server-only x402 v2 exact payments. The SDK owns authorization and covenant checks.
import { Keypair, TransactionBuilder, type Transaction, type xdr } from "@stellar/stellar-sdk";
import { KovanError, paymentIdForRequest } from "@kovan-protocol/sdk";
import { feePayerKeypair, resolveAgentSecret } from "./agent";
import { kovanClient } from "./kovan";
import { ids, NETWORK_PASSPHRASE, rpcServer, withRetry } from "./stellar";
import { fetchPaymentResource } from "./x402-http";
import {
  decodePaymentResponse, encodePaymentHeader, parsePaymentRequired, paymentQuoteId,
  paymentUrl, pickStellarRequirement, REQ_HEADER, RES_HEADER, SIG_HEADER, X402_NETWORK,
  type PaymentRequired, type PaymentRequirement,
} from "./x402";

export type Terms = { url: string; description?: string; payTo: string; amount: string; asset: string; maxTimeoutSeconds: number; quoteId: string; pr: PaymentRequired; req: PaymentRequirement };
export const publicTerms = (t: Terms) => ({ url: t.url, description: t.description, payTo: t.payTo, amount: t.amount, asset: t.asset, maxTimeoutSeconds: t.maxTimeoutSeconds, quoteId: t.quoteId });

/** Discover only the supported profile; no keys are accessed and no payment is made. */
export async function discoverTerms(value: string): Promise<Terms> {
  const url = paymentUrl(value);
  const r = await fetchPaymentResource(url);
  const h = r.headers.get(REQ_HEADER);
  if (r.status !== 402 || !h) throw new Error(`endpoint answered ${r.status} without valid ${REQ_HEADER}; redirects are not followed`);
  const pr = parsePaymentRequired(h);
  if (paymentUrl(pr.resource.url) !== url) throw new Error("Payment resource does not match the requested URL");
  const req = pickStellarRequirement(pr);
  if (req.asset !== ids().usdc) throw new Error("Payment asset is not the configured testnet USDC contract");
  return { url, description: pr.resource.description, payTo: req.payTo, amount: req.amount, asset: req.asset, maxTimeoutSeconds: req.maxTimeoutSeconds, quoteId: paymentQuoteId(url, req), pr, req };
}

export type X402Result =
  | { ok: true; paymentStatus: "confirmed"; status: number; txHash: string; body: string; contentType: string | null; terms: ReturnType<typeof publicTerms> }
  | { ok: false; paymentStatus: "not_sent" | "unknown" | "confirmed"; stage: "guard" | "terms" | "simulate" | "settle"; status?: number; error: string; txHash?: string; terms?: ReturnType<typeof publicTerms> };

function inner(tx: ReturnType<typeof TransactionBuilder.fromXDR>): Transaction {
  return "innerTransaction" in tx ? tx.innerTransaction : tx;
}

/** The facilitator may change the source/fees, but not our transfer or signed auth. */
export function assertSettlementMatches(preparedXdr: string, envelope: xdr.TransactionEnvelope, receiptHash: string): void {
  const observed = TransactionBuilder.fromXDR(envelope, NETWORK_PASSPHRASE);
  const settled = inner(observed);
  if (![observed.hash().toString("hex"), settled.hash().toString("hex")].includes(receiptHash.toLowerCase())) throw new Error("Settlement transaction hash mismatch");
  const expected = inner(TransactionBuilder.fromXDR(preparedXdr, NETWORK_PASSPHRASE));
  const a = expected.operations[0];
  const b = settled.operations[0];
  if (expected.operations.length !== 1 || settled.operations.length !== 1 || a.type !== "invokeHostFunction" || b.type !== "invokeHostFunction"
      || !a.func.toXDR().equals(b.func.toXDR()) || a.auth?.length !== 1 || b.auth?.length !== 1 || !a.auth[0].toXDR().equals(b.auth[0].toXDR())) {
    throw new Error("Settlement does not contain this payment's exact transfer and authorization");
  }
}

export async function payEndpoint(agent: string, url: string, options: { quoteId: string; pool?: string; mandateId?: string; requestId?: string }): Promise<X402Result> {
  let terms: Terms;
  try {
    terms = await discoverTerms(url);
    if (terms.quoteId !== options.quoteId) return { ok: false, paymentStatus: "not_sent", stage: "terms", error: "Payment terms changed; review the new terms before authorizing another request", terms: publicTerms(terms) };
  } catch (e) {
    return { ok: false, paymentStatus: "not_sent", stage: "terms", error: (e as Error).message };
  }

  let preparedXdr: string;
  try {
    const payment = options.mandateId ? { mandateId: options.mandateId, paymentId: paymentIdForRequest(options.requestId ?? ""), reference: terms.quoteId } : undefined;
    const client = await kovanClient(options.pool);
    const { pool, verifier } = ids(options.pool);
    const key = Keypair.fromSecret(await resolveAgentSecret(agent, verifier));
    const source = (await feePayerKeypair()).publicKey();
    const prepared = await client.pool(pool).prepareAgent("pay", { agent, to: terms.payTo, amount: terms.amount, ...(payment ? { payment } : {}) }, {
      source, timeoutSeconds: terms.maxTimeoutSeconds,
      signer: { publicKey: key.rawPublicKey().toString("hex"), sign: (digest) => key.sign(Buffer.from(digest)) },
    });
    preparedXdr = prepared.xdr; // Envelope stays unsigned: only the facilitator pays fees.
  } catch (e) {
    return { ok: false, paymentStatus: "not_sent", stage: e instanceof KovanError && e.stage === "simulate" ? "simulate" : "guard", error: (e as Error).message, terms: publicTerms(terms) };
  }

  // From here a transport error is ambiguous: the server may already have settled.
  // Never automatically retry this request or issue a fresh authorization.
  try {
    const r = await fetchPaymentResource(terms.url, { [SIG_HEADER]: encodePaymentHeader(terms.pr, terms.req, preparedXdr) });
    const settlement = decodePaymentResponse(r.headers.get(RES_HEADER));
    if (!settlement?.success || !settlement.transaction || settlement.network !== X402_NETWORK || (settlement.payer !== undefined && settlement.payer !== agent)) throw new Error("Missing, failed, or mismatched payment settlement receipt");
    const server = rpcServer();
    if ((await withRetry(() => server.getNetwork())).passphrase !== NETWORK_PASSPHRASE) throw new Error("Settlement RPC network mismatch");
    const confirmed = await withRetry(() => server.getTransaction(settlement.transaction!));
    if (confirmed.status !== "SUCCESS") throw new Error(`Payment not confirmed by Stellar RPC (${confirmed.status})`);
    assertSettlementMatches(preparedXdr, confirmed.envelopeXdr, settlement.transaction);
    if (r.status < 200 || r.status >= 300) return { ok: false, stage: "settle", paymentStatus: "confirmed", status: r.status, txHash: settlement.transaction, error: `Payment confirmed, but resource returned HTTP ${r.status}. Do not pay again.`, terms: publicTerms(terms) };
    return { ok: true, paymentStatus: "confirmed", status: r.status, txHash: settlement.transaction, body: r.body.slice(0, 4000), contentType: r.headers.get("content-type"), terms: publicTerms(terms) };
  } catch (e) {
    return { ok: false, stage: "settle", paymentStatus: "unknown", error: `${(e as Error).message}. Authorization was sent or may have been sent; reconcile before making a new payment.`, terms: publicTerms(terms) };
  }
}
