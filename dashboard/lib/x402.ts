// x402 v2 "exact" on Stellar, paid from a Kovan agent account.
// Spec: coinbase/x402 specs/schemes/exact/scheme_exact_stellar.md.
//   402 → PAYMENT-REQUIRED header (base64 JSON PaymentRequired)
//   retry with PAYMENT-SIGNATURE header (base64 JSON PaymentPayload{ payload: { transaction } })
//   200 → PAYMENT-RESPONSE header (base64 JSON settlement)
// The transaction carries one `transfer(from=agent, to=payTo, amount)` and the
// agent account's signed auth entry; the facilitator re-sources and submits it.

export type PaymentRequirement = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};
export type PaymentRequired = {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirement[];
};
export type PaymentResponse = { success: boolean; transaction?: string; network?: string; payer?: string; errorReason?: string };

export const REQ_HEADER = "payment-required";
export const SIG_HEADER = "payment-signature";
export const RES_HEADER = "payment-response";

export function parsePaymentRequired(headerB64: string): PaymentRequired {
  const j = JSON.parse(Buffer.from(headerB64, "base64").toString("utf8")) as PaymentRequired;
  if (j.x402Version !== 2 || !Array.isArray(j.accepts)) throw new Error("not an x402 v2 PaymentRequired");
  return j;
}

export function pickStellarRequirement(pr: PaymentRequired, network = "stellar:testnet"): PaymentRequirement {
  const r = pr.accepts.find((a) => a.scheme === "exact" && a.network === network);
  if (!r) throw new Error(`endpoint does not accept exact payments on ${network}`);
  return r;
}

export function encodePaymentHeader(pr: PaymentRequired, accepted: PaymentRequirement, transactionXdr: string): string {
  const payload = { x402Version: 2, resource: pr.resource, accepted, payload: { transaction: transactionXdr } };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodePaymentResponse(headerB64: string | null): PaymentResponse | null {
  if (!headerB64) return null;
  try {
    return JSON.parse(Buffer.from(headerB64, "base64").toString("utf8")) as PaymentResponse;
  } catch {
    return null;
  }
}

/** Ledgers an auth entry may live, per spec: ceil(maxTimeoutSeconds / ~5 s). */
export const ledgerTimeout = (maxTimeoutSeconds: number, ledgerSeconds = 5) => Math.ceil(maxTimeoutSeconds / ledgerSeconds);
