import { describe as suite, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { ownerRequest } from "../src/cli";
import { RequestError } from "../src/request";

const POOL = StrKey.encodeContract(Buffer.alloc(32, 1));
const AGENT = StrKey.encodeContract(Buffer.alloc(32, 2));
const P1 = Keypair.random().publicKey();
const P2 = Keypair.random().publicKey();
const key = Keypair.random();

suite("owner flags map to the same validated requests as signing links", () => {
  it("fund", () => {
    expect(ownerRequest("fund", { pool: POOL, amount: "100" })).toEqual({ fn: "fund", pool: POOL, amount: 1_000_000_000n });
  });
  it("create_agent splits lists and parses hours", () => {
    const r = ownerRequest("create_agent", {
      pool: POOL, "agent-key": key.publicKey(), "draw-limit": "40", providers: `${P1}, ${P2}`,
      "provider-per-transfer-cap": "0.5", "provider-total-cap": "40", "expiry-hours": "48",
    });
    expect(r).toMatchObject({ fn: "create_agent", providers: [P1, P2], drawLimit: 400_000_000n, expiryHours: 48, agentPubkeyHex: key.rawPublicKey().toString("hex") });
  });
  it("revoke takes the agent; the owner comes from --owner, not the request", () => {
    expect(ownerRequest("revoke", { pool: POOL, agent: AGENT, owner: P1 })).toEqual({ fn: "revoke", pool: POOL, agent: AGENT });
  });
  it("keeps the request's refusals", () => {
    expect(() => ownerRequest("close_pool", { pool: POOL })).toThrow(/Unknown action/);
    expect(() => ownerRequest("fund", { pool: P1, amount: "1" })).toThrow(RequestError);
    expect(() => ownerRequest("create_agent", { pool: POOL, "agent-key": key.secret(), "draw-limit": "1", providers: P1, "provider-per-transfer-cap": "1", "provider-total-cap": "1" })).toThrow(/SECRET/);
    expect(() => ownerRequest("create_agent", { pool: POOL, "agent-key": key.publicKey(), "draw-limit": "1", providers: P1, "provider-per-transfer-cap": "1", "provider-total-cap": "1", "expiry-hours": "abc" })).toThrow(/expiry_hours/);
  });
});
