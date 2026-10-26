import { describe, expect, it } from "vitest";
import { encodePaymentHeader, parsePaymentRequired, pickStellarRequirement, decodePaymentResponse, paymentQuoteId, paymentUrl, ledgerTimeout } from "@/lib/x402";

const HEADER =
  "eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cHM6Ly9zdGVsbGFyLm9yZy94NDAyLWRlbW8vYXBpL3Byb3RlY3RlZC90ZXN0bmV0IiwiZGVzY3JpcHRpb24iOiJBY2Nlc3MgdG8gcHJvdGVjdGVkIGNvbnRlbnQiLCJtaW1lVHlwZSI6IiJ9LCJhY2NlcHRzIjpbeyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJzdGVsbGFyOnRlc3RuZXQiLCJhbW91bnQiOiIxMDAwMDAiLCJhc3NldCI6IkNCSUVMVEs2WUJaSlU1VVAyV1dRRVVDWUtMUFU2QVVOWjJCUTRXV0ZFSUUzVVNDSUhNWFFEQU1BIiwicGF5VG8iOiJHQ0hFSTRQUUVGSk9BMjdNTlpSUFFOTEdVUlM2S0FTVzc2WDVVWkNVWklYQ09KTEtYWUNYT1IyVyIsIm1heFRpbWVvdXRTZWNvbmRzIjozMDAsImV4dHJhIjp7ImFyZUZlZXNTcG9uc29yZWQiOnRydWV9fV19";

describe("parsePaymentRequired", () => {
  it("decodes the base64 PAYMENT-REQUIRED header", () => {
    const pr = parsePaymentRequired(HEADER);
    expect(pr.x402Version).toBe(2);
    expect(pr.resource.url).toBe("https://stellar.org/x402-demo/api/protected/testnet");
    expect(pr.accepts).toHaveLength(1);
  });
  it("picks the stellar:testnet exact requirement", () => {
    const req = pickStellarRequirement(parsePaymentRequired(HEADER));
    expect(req.payTo).toBe("GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W");
    expect(req.amount).toBe("100000");
    expect(req.asset).toBe("CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
    expect(req.maxTimeoutSeconds).toBe(300);
  });
  it("refuses when no stellar:testnet requirement exists", () => {
    const pr = parsePaymentRequired(HEADER);
    pr.accepts[0].network = "stellar:pubnet";
    expect(() => pickStellarRequirement(pr)).toThrow(/stellar:testnet/);
  });
});

describe("encodePaymentHeader", () => {
  it("wraps the transaction in a v2 PaymentPayload and base64-encodes it", () => {
    const pr = parsePaymentRequired(HEADER);
    const h = encodePaymentHeader(pr, pr.accepts[0], "AAAA");
    const j = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
    expect(j).toEqual({ x402Version: 2, resource: pr.resource, accepted: pr.accepts[0], payload: { transaction: "AAAA" } });
  });
});

describe("decodePaymentResponse", () => {
  it("returns the settlement fields", () => {
    const h = Buffer.from(JSON.stringify({ success: true, transaction: "a".repeat(64), network: "stellar:testnet", payer: "C1" })).toString("base64");
    expect(decodePaymentResponse(h)).toMatchObject({ success: true, transaction: "a".repeat(64) });
  });
  it("tolerates a missing header", () => expect(decodePaymentResponse(null)).toBeNull());
});

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("fail-closed x402 profile", () => {
  it.each([null, {}, { x402Version: 1, accepts: [] }, { x402Version: 2, accepts: [] }, { x402Version: 2, accepts: [null], resource: { url: "https://example.com" } }])("rejects malformed requirements %j", (value) => {
    expect(() => parsePaymentRequired(encode(value))).toThrow();
  });
  it.each(["%%%", "A".repeat(17000), Buffer.from([0xff]).toString("base64")])("rejects invalid/oversized encoding", (header) => expect(() => parsePaymentRequired(header)).toThrow());
  it("rejects unsupported extensions", () => {
    expect(() => parsePaymentRequired(encode({ ...parsePaymentRequired(HEADER), extensions: { permit: {} } }))).toThrow(/extensions/);
  });
  it.each(["0", "-1", "01", "1.5", "1e7", " 10", 10, (1n << 127n).toString()])("rejects ambiguous or out-of-range amount %s", (amount) => {
    const pr = parsePaymentRequired(HEADER);
    pr.accepts[0].amount = amount as string;
    expect(() => pickStellarRequirement(pr)).toThrow(/amount/i);
  });
  it.each([0, -1, 0.5, 301, Infinity, NaN])("rejects unsafe timeout %s", (timeout) => {
    const pr = parsePaymentRequired(HEADER);
    pr.accepts[0].maxTimeoutSeconds = timeout;
    expect(() => pickStellarRequirement(pr)).toThrow(/timeout/);
    expect(() => ledgerTimeout(timeout)).toThrow(/timeout/);
  });
  it("checks addresses, sponsorship, and unsupported extra features", () => {
    for (const patch of [{ payTo: "bad" }, { asset: "bad" }, { extra: undefined }, { extra: { areFeesSponsored: false } }, { extra: { areFeesSponsored: true, arbitrary: "ignored?" } }]) {
      const pr = parsePaymentRequired(HEADER);
      Object.assign(pr.accepts[0], patch);
      expect(() => pickStellarRequirement(pr)).toThrow();
    }
  });
  it.each(["http://example.com", "https://u:p@example.com", "https://example.com:444", "https://example.com/#fragment", "https://example.com/ bad", "https://example.com\\@localhost"])('rejects unsafe URL %s', (url) => expect(() => paymentUrl(url)).toThrow());
  it("binds the quote to the exact URL, asset, recipient, amount and expiry", () => {
    const req = pickStellarRequirement(parsePaymentRequired(HEADER));
    const id = paymentQuoteId("https://example.com/path?a=1", req);
    expect(paymentQuoteId("https://example.com:443/path?a=1", req)).toBe(id);
    for (const patch of [{ amount: "2" }, { payTo: "different" }, { asset: "different" }, { maxTimeoutSeconds: 30 }]) {
      expect(paymentQuoteId("https://example.com/path?a=1", { ...req, ...patch })).not.toBe(id);
    }
    expect(paymentQuoteId("https://example.com/path?a=2", req)).not.toBe(id);
  });
  it.each([{}, { success: "true" }, { success: true, transaction: "abc", network: "stellar:testnet" }, { success: true, transaction: "a".repeat(64) }])("does not trust malformed settlement %j", (value) => expect(decodePaymentResponse(encode(value))).toBeNull());
});
