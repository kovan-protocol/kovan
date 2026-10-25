import { describe, expect, it } from "vitest";
import { decodeContractError, explainError } from "@/lib/errors";

describe("decodeContractError", () => {
  it("names covenant errors", () =>
    expect(decodeContractError("HostError: Error(Contract, #3904)")).toEqual({ code: 3904, name: "PayeeNotAllowed", source: "covenant" }));
  it("names pool errors", () =>
    expect(decodeContractError("Error(Contract, #6)")).toMatchObject({ name: "NotActive", source: "pool" }));
  it("names smart-account errors", () =>
    expect(decodeContractError("x Error(Contract, #3003) y")).toMatchObject({ name: "ExternalVerificationFailed" }));
  it("returns null when there is no contract error", () => expect(decodeContractError("Error(Auth, InvalidAction)")).toBeNull());
});

describe("explainError", () => {
  it("prefers the decoded code", () => expect(explainError("... Error(Contract, #3906) ...")).toBe("#3906 PerTransferCapExceeded"));
  it("explains auth errors", () => expect(explainError("Error(Auth, InvalidAction)")).toMatch(/signer is not allowed/));
});
