import { describe, expect, it } from "vitest";
import { ledgerFromHours, unitsFromUsdc, usdc } from "@/lib/format";

describe("usdc", () => {
  it("formats half a dollar", () => expect(usdc(5_000_000n)).toBe("0.50 USDC"));
  it("formats whole dollars with two decimals", () => expect(usdc("20000000")).toBe("2.00 USDC"));
  it("keeps needed precision", () => expect(usdc(1n)).toBe("0.0000001 USDC"));
  it("groups thousands", () => expect(usdc(12_345_000_000_000n)).toBe("1,234,500.00 USDC"));
});

describe("unitsFromUsdc", () => {
  it("parses whole", () => expect(unitsFromUsdc("2")).toBe(20_000_000n));
  it("parses fraction", () => expect(unitsFromUsdc("0.5")).toBe(5_000_000n));
  it("rejects too many decimals", () => expect(() => unitsFromUsdc("0.00000001")).toThrow());
  it("rejects junk", () => expect(() => unitsFromUsdc("abc")).toThrow());
});

describe("ledgerFromHours", () => {
  it("adds ceil(hours*3600/5) to the latest ledger", () => expect(ledgerFromHours(1000, 1)).toBe(1720));
  it("never anchors at zero", () => expect(ledgerFromHours(5_382_000, 0.5)).toBe(5_382_360));
  it("rejects non-positive", () => expect(() => ledgerFromHours(1, 0)).toThrow());
});
