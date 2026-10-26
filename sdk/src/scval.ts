import { Buffer } from "buffer";
// Hand-built ScVal encoders for the covenant types. Soroban encodes a struct as
// an ScMap with symbol keys in sorted order, Option::None as void, Vec as vec.
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export type CallRuleInput = { contract: string; fn_name: string; amount_arg: number | undefined | null; amount_cap: bigint | string };
export type CovenantInput = {
  pool: string;
  usdc: string;
  providers: string[];
  provider_per_transfer_cap: bigint | string;
  provider_total_cap: bigint | string;
  recipients: string[];
  recipient_per_transfer_cap: bigint | string;
  recipient_total_cap: bigint | string;
  calls: CallRuleInput[];
  expiry: number;
};

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
export const addrVal = (a: string) => new Address(a).toScVal();
export const i128Val = (v: bigint | string) => {
  if (typeof v !== "bigint" && (typeof v !== "string" || !/^-?\d+$/.test(v))) throw new Error("Expected integer base units");
  const n = BigInt(v);
  if (n < -(1n << 127n) || n >= (1n << 127n)) throw new Error("Amount is outside i128 range");
  return nativeToScVal(n, { type: "i128" });
};
export const u32Val = (v: number) => {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error("Expected u32");
  return xdr.ScVal.scvU32(v);
};
export function positiveAmount(value: string): xdr.ScVal {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error("Amount must be positive integer base units");
  return i128Val(value);
}
export const bytes32Val = (hex: string) => {
  if (typeof hex !== "string" || !/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error("expected 32 bytes in hex");
  const b = Buffer.from(hex, "hex");
  if (b.length !== 32) throw new Error("expected 32 bytes");
  return xdr.ScVal.scvBytes(b);
};

/** Struct → ScMap with keys sorted by symbol name. */
export function structVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort()
    .map((k) => new xdr.ScMapEntry({ key: sym(k), val: fields[k] }));
  return xdr.ScVal.scvMap(entries);
}

export const optionU32 = (v: number | undefined | null) => (v === undefined || v === null ? xdr.ScVal.scvVoid() : u32Val(v));

export function callRuleToScVal(c: CallRuleInput): xdr.ScVal {
  return structVal({
    contract: addrVal(c.contract),
    fn_name: sym(c.fn_name),
    amount_arg: optionU32(c.amount_arg),
    amount_cap: i128Val(c.amount_cap),
  });
}

export function covenantToScVal(c: CovenantInput): xdr.ScVal {
  return structVal({
    pool: addrVal(c.pool),
    usdc: addrVal(c.usdc),
    providers: xdr.ScVal.scvVec(c.providers.map(addrVal)),
    provider_per_transfer_cap: i128Val(c.provider_per_transfer_cap),
    provider_total_cap: i128Val(c.provider_total_cap),
    recipients: xdr.ScVal.scvVec(c.recipients.map(addrVal)),
    recipient_per_transfer_cap: i128Val(c.recipient_per_transfer_cap),
    recipient_total_cap: i128Val(c.recipient_total_cap),
    calls: xdr.ScVal.scvVec(c.calls.map(callRuleToScVal)),
    expiry: u32Val(c.expiry),
  });
}

export function amendmentToScVal(a: {
  provider_per_transfer_cap: bigint | string;
  provider_total_cap: bigint | string;
  recipient_per_transfer_cap: bigint | string;
  recipient_total_cap: bigint | string;
  expiry: number;
}): xdr.ScVal {
  return structVal({
    provider_per_transfer_cap: i128Val(a.provider_per_transfer_cap),
    provider_total_cap: i128Val(a.provider_total_cap),
    recipient_per_transfer_cap: i128Val(a.recipient_per_transfer_cap),
    recipient_total_cap: i128Val(a.recipient_total_cap),
    expiry: u32Val(a.expiry),
  });
}
