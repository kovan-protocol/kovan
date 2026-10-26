import { Buffer } from "buffer";
import { hash, xdr } from "@stellar/stellar-sdk";
import { addrVal, bytes32Val, positiveAmount, structVal, u32Val } from "./scval.js";

export const MANDATE_VERSION = 1;
export type PaymentTerms = { asset: string; payee: string; amount: bigint; reference: Uint8Array };
export type MandateState = {
  params: { id: Uint8Array; intent_hash: Uint8Array; expiry: number; scope: ["Budget", { payees: string[]; per_payment_cap: bigint; total_cap: bigint }] | ["Exact", PaymentTerms] };
  spent: bigint; payments: number; revoked: boolean;
};
export type PaymentReceipt = { payment_id: Uint8Array; mandate_id: Uint8Array; terms: PaymentTerms; authorization_hash: Uint8Array; ledger: number };
export type MandateInput = {
  id: string; intent_hash: string; expiry: number;
  scope: { kind: "budget"; payees: string[]; per_payment_cap: string; total_cap: string }
    | { kind: "exact"; asset: string; payee: string; amount: string; reference: string };
};
export type PaymentBinding = Readonly<{ mandateId: string; paymentId: string; reference: string; validUntil: number }>;
export type PaymentRequest = Omit<PaymentBinding, "validUntil"> & { validUntil?: number };

export function nonzeroBytes32(value: string): xdr.ScVal {
  const result = bytes32Val(value);
  if (/^0{64}$/.test(value)) throw new Error("Mandate IDs and commitments must be nonzero");
  return result;
}

export function mandateToScVal(m: MandateInput): xdr.ScVal {
  let scope: xdr.ScVal;
  if (m.scope.kind === "budget") {
    const b = m.scope;
    if (!Array.isArray(b.payees) || b.payees.length < 1 || b.payees.length > 16 || new Set(b.payees).size !== b.payees.length) throw new Error("Mandate requires 1–16 distinct payees");
    const cap = positiveAmount(b.per_payment_cap), total = positiveAmount(b.total_cap);
    if (BigInt(b.per_payment_cap) > BigInt(b.total_cap)) throw new Error("Per-payment cap exceeds mandate budget");
    scope = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Budget"), structVal({ payees: xdr.ScVal.scvVec(b.payees.map(addrVal)), per_payment_cap: cap, total_cap: total })]);
  } else if (m.scope.kind === "exact") {
    const t = m.scope;
    scope = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Exact"), structVal({ asset: addrVal(t.asset), payee: addrVal(t.payee), amount: positiveAmount(t.amount), reference: nonzeroBytes32(t.reference) })]);
  } else throw new Error("Unsupported mandate scope");
  if (m.expiry <= 0) throw new Error("Mandate expiry must be positive");
  return structVal({ id: nonzeroBytes32(m.id), intent_hash: nonzeroBytes32(m.intent_hash), expiry: u32Val(m.expiry), scope });
}

export function paymentBindingToScVal(p: PaymentBinding): xdr.ScVal {
  if (p.validUntil <= 0) throw new Error("Payment deadline must be positive");
  return structVal({ mandate_id: nonzeroBytes32(p.mandateId), payment_id: nonzeroBytes32(p.paymentId), reference: nonzeroBytes32(p.reference), valid_until: u32Val(p.validUntil) });
}

/** SHA256(XDR((domain, hostPayload, payment))). Matches covenant-types::payment_payload. */
export function paymentPayloadHash(hostPayload: Buffer, payment: PaymentBinding): Buffer {
  return hash(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("kovan_mandate_payment_v1"), xdr.ScVal.scvBytes(hostPayload), paymentBindingToScVal(payment)]).toXDR());
}

/** Persist the original request ID. Never generate a fresh ID just to retry. */
export function paymentIdForRequest(requestId: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error("Invalid persistent payment request ID");
  return hash(Buffer.from(`kovan:payment:v1:${requestId}`, "utf8")).toString("hex");
}
