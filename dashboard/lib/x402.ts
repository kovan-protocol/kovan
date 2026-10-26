// x402 v2 "exact" on Stellar, paid from a Kovan agent account.
// Spec: coinbase/x402 specs/schemes/exact/scheme_exact_stellar.md.
//   402 → PAYMENT-REQUIRED header (base64 JSON PaymentRequired)
//   retry with PAYMENT-SIGNATURE header (base64 JSON PaymentPayload{ payload: { transaction } })
//   200 → PAYMENT-RESPONSE header (base64 JSON settlement)
// The transaction carries one `transfer(from=agent, to=payTo, amount)` and the
// agent account's signed auth entry; the facilitator re-sources and submits it.
import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";

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
export const X402_NETWORK = "stellar:testnet";
export const MAX_PAYMENT_TIMEOUT = 300;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decode(header: string): unknown {
  if (typeof header !== "string" || header.length > 16_384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) throw new Error("Invalid or oversized x402 header");
  const bytes = Buffer.from(header, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== header.replace(/=+$/, "")) throw new Error("Invalid x402 base64 encoding");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Deliberately narrow local-console profile: public HTTPS GET, standard port. */
export function paymentUrl(value: string): string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\]/.test(value)) throw new Error("Invalid payment URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw new Error("Payment URL must use HTTPS port 443 without credentials or a fragment");
  }
  return url.href;
}

export function parsePaymentRequired(headerB64: string): PaymentRequired {
  const j = decode(headerB64);
  if (!object(j) || j.x402Version !== 2 || !Array.isArray(j.accepts) || j.accepts.length < 1 || j.accepts.length > 16
      || !object(j.resource) || typeof j.resource.url !== "string"
      || (j.resource.description !== undefined && (typeof j.resource.description !== "string" || j.resource.description.length > 1024))) {
    throw new Error("not a supported x402 v2 PaymentRequired");
  }
  paymentUrl(j.resource.url);
  if (j.extensions !== undefined && (!object(j.extensions) || Object.keys(j.extensions).length > 0)) {
    throw new Error("x402 extensions are not supported by this payment profile");
  }
  if (j.accepts.some((a) => !object(a) || typeof a.scheme !== "string" || typeof a.network !== "string")) throw new Error("Invalid x402 payment alternatives");
  return j as PaymentRequired;
}

export function pickStellarRequirement(pr: PaymentRequired, network = X402_NETWORK): PaymentRequirement {
  const r = pr.accepts.find((a) => a.scheme === "exact" && a.network === network);
  if (!r) throw new Error(`endpoint does not accept exact payments on ${network}`);
  if (typeof r.amount !== "string" || !/^[1-9][0-9]{0,38}$/.test(r.amount) || BigInt(r.amount) > (1n << 127n) - 1n) throw new Error("Payment amount must be a positive i128 integer string");
  if (typeof r.asset !== "string" || !StrKey.isValidContract(r.asset)) throw new Error("Payment asset must be a contract address");
  if (typeof r.payTo !== "string" || !(StrKey.isValidEd25519PublicKey(r.payTo) || StrKey.isValidContract(r.payTo))) throw new Error("Invalid payment recipient");
  if (!Number.isSafeInteger(r.maxTimeoutSeconds) || r.maxTimeoutSeconds < 1 || r.maxTimeoutSeconds > MAX_PAYMENT_TIMEOUT) throw new Error("Payment timeout must be between 1 and 300 seconds");
  if (!object(r.extra) || r.extra.areFeesSponsored !== true || Object.keys(r.extra).some((key) => key !== "areFeesSponsored")) throw new Error("Only fee-sponsored Stellar exact payments without extra features are supported");
  return r;
}

/** Binds what the caller reviewed; this hash is not a new authorization grant. */
export function paymentQuoteId(url: string, r: PaymentRequirement): string {
  return createHash("sha256").update(JSON.stringify([
    "kovan:x402:quote:v1", "GET", paymentUrl(url), r.scheme, r.network, r.asset, r.payTo, r.amount, r.maxTimeoutSeconds, true,
  ])).digest("hex");
}

export function encodePaymentHeader(pr: PaymentRequired, accepted: PaymentRequirement, transactionXdr: string): string {
  const payload = { x402Version: 2, resource: pr.resource, accepted, payload: { transaction: transactionXdr } };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodePaymentResponse(headerB64: string | null): PaymentResponse | null {
  if (!headerB64) return null;
  try {
    const j = decode(headerB64);
    if (!object(j) || typeof j.success !== "boolean") return null;
    if (j.success && (typeof j.transaction !== "string" || !/^[a-f0-9]{64}$/i.test(j.transaction)
        || typeof j.network !== "string" || (j.payer !== undefined && typeof j.payer !== "string"))) return null;
    if (j.errorReason !== undefined && typeof j.errorReason !== "string") return null;
    return j as PaymentResponse;
  } catch {
    return null;
  }
}

/** Ledgers an auth entry may live, per spec: ceil(maxTimeoutSeconds / ~5 s). */
export function ledgerTimeout(maxTimeoutSeconds: number, ledgerSeconds = 5): number {
  if (!Number.isSafeInteger(maxTimeoutSeconds) || maxTimeoutSeconds < 1 || maxTimeoutSeconds > MAX_PAYMENT_TIMEOUT || !Number.isFinite(ledgerSeconds) || ledgerSeconds <= 0) throw new Error("Invalid payment timeout");
  return Math.ceil(maxTimeoutSeconds / ledgerSeconds);
}
