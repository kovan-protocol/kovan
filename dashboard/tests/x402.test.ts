import { describe, expect, it } from "vitest";
import { encodePaymentHeader, parsePaymentRequired, pickStellarRequirement, decodePaymentResponse } from "@/lib/x402";

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
    const h = Buffer.from(JSON.stringify({ success: true, transaction: "abc", network: "stellar:testnet", payer: "C1" })).toString("base64");
    expect(decodePaymentResponse(h)).toMatchObject({ success: true, transaction: "abc" });
  });
  it("tolerates a missing header", () => expect(decodePaymentResponse(null)).toBeNull());
});
