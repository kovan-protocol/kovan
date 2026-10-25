import { describe, expect, it } from "vitest";
import { decodeContractError, explainError, scErrorToText } from "@/lib/errors";
import { clampWindow } from "@/lib/events";
import { envOr } from "@/lib/stellar";

describe("envOr", () => {
  it("falls back when the env value is empty", () => expect(envOr("", "fallback")).toBe("fallback"));
  it("falls back when undefined", () => expect(envOr(undefined, "fallback")).toBe("fallback"));
  it("uses a set value", () => expect(envOr("CABC", "fallback")).toBe("CABC"));
});

describe("scErrorToText", () => {
  it("renders a contract ScError as Error(Contract, #N)", () =>
    expect(scErrorToText({ type: "contract", code: 3904 })).toBe("Error(Contract, #3904)"));
  it("renders a system auth error as Error(Auth, …)", () =>
    expect(scErrorToText({ type: "system", code: 6, value: "scecInvalidAction" })).toMatch(/^Error\(Auth/));
  it("maps txBadAuth", () => expect(explainError("txBadAuth")).toMatch(/signature/i));
});

describe("contract-aware error names", () => {
  const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
  const POOL = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
  it("names SAC #10 as BalanceError when the SAC raised it", () =>
    expect(decodeContractError(`contract:${USDC} Error(Contract, #10)`, { usdc: USDC, pool: POOL })).toMatchObject({ name: "BalanceError", source: "usdc" }));
  it("names pool #10 as Insufficient when the pool raised it", () =>
    expect(decodeContractError(`contract:${POOL} Error(Contract, #10)`, { usdc: USDC, pool: POOL })).toMatchObject({ name: "Insufficient", source: "pool" }));
  it("still names covenant codes without context", () =>
    expect(decodeContractError("Error(Contract, #3904)")).toMatchObject({ name: "PayeeNotAllowed" }));
});

describe("clampWindow", () => {
  it("keeps the requested start when retention covers it", () =>
    expect(clampWindow({ latest: 1000, span: 100, oldestAvailable: 500 })).toEqual({ start: 900, truncated: false }));
  it("clamps to the oldest available ledger and flags truncation", () =>
    expect(clampWindow({ latest: 1000, span: 900, oldestAvailable: 500 })).toEqual({ start: 500, truncated: true }));
});
