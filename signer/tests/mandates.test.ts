import { describe as suite, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, parseRequest, encodeRequest, parseHash } from "../src/request";
import { ownerRequest } from "../src/cli";
const pool = StrKey.encodeContract(Buffer.alloc(32, 1)), agent = StrKey.encodeContract(Buffer.alloc(32, 2)), payee = Keypair.random().publicKey();
const base = { v: 1, fn: "create_mandate", pool, agent, mandate_id: "1".repeat(64), intent_hash: "2".repeat(64), expiry_ledger: 1000 };
suite("owner mandate links and CLI", () => {
  it("round trips an exact approval and shows its scope", () => {
    const r = parseHash(encodeRequest({ ...base, scope: "exact", payee, amount: "0.01", reference: "3".repeat(64) }))!.req;
    expect(r).toMatchObject({ fn: "create_mandate", mandate: { expiry: 1000, scope: { kind: "exact", amount: "100000", payee } } });
    expect(describe(r).title).toMatch(/one exact/);
    expect(describe(r).rows).toContainEqual(["Purchase reference", "3".repeat(64)]);
  });
  it("parses a budget from CLI flags with exact USDC precision", () => {
    const r = ownerRequest("create_mandate", { pool, agent, "mandate-id": base.mandate_id, "intent-hash": base.intent_hash, "expiry-ledger": "1000", scope: "budget", payees: payee, "per-payment-cap": "0.1", "total-cap": "0.3" });
    expect(r).toMatchObject({ mandate: { scope: { kind: "budget", payees: [payee], per_payment_cap: "1000000", total_cap: "3000000" } } });
    expect(describe(r).notes.join(" ")).toMatch(/Different IDs/);
  });
  it("revokes only the named immutable mandate", () => {
    const r = ownerRequest("revoke_mandate", { pool, agent, "mandate-id": base.mandate_id });
    expect(r).toEqual({ fn: "revoke_mandate", pool, agent, mandateId: base.mandate_id });
  });
  it.each([
    { mandate_id: "0".repeat(64) }, { intent_hash: "bad" }, { expiry_ledger: -1 }, { expiry_ledger: 0x100000000 },
    { scope: "unknown" }, { reference: "0".repeat(64) }, { asset: pool }, { total_cap: "0.1" },
  ])("refuses malformed/widened exact approvals %j", patch => {
    expect(() => parseRequest({ ...base, scope: "exact", payee, amount: "0.01", reference: "3".repeat(64), ...patch })).toThrow();
  });
  it("refuses empty/duplicate payees and a budget below its per-payment cap", () => {
    for (const patch of [{ payees: [] }, { payees: [payee, payee] }, { per_payment_cap: "2" }]) {
      expect(() => parseRequest({ ...base, scope: "budget", payees: [payee], per_payment_cap: "0.1", total_cap: "1", ...patch })).toThrow();
    }
  });
});
