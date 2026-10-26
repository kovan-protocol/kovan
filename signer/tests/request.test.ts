import { describe as suite, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { callbackUrl, describe, encodeRequest, formatUsdc, ledgerFromHours, parseEnvelope, parseHash, parseRequest, RequestError, usdc } from "../src/request";

const POOL = StrKey.encodeContract(Buffer.alloc(32, 1));
const AGENT = StrKey.encodeContract(Buffer.alloc(32, 2));
const PROVIDER = Keypair.random().publicKey();
const RECIPIENT = StrKey.encodeContract(Buffer.alloc(32, 3));
const agentKp = Keypair.random();

const agentReq = (over: Record<string, unknown> = {}) => ({
  v: 1, fn: "create_agent", pool: POOL, agent_key: agentKp.publicKey(), draw_limit: "10",
  providers: [PROVIDER], provider_per_transfer_cap: "0.5", provider_total_cap: "10", expiry_hours: 24, ...over,
});

suite("link format", () => {
  it("round-trips through the #r= fragment", () => {
    const env = parseHash(encodeRequest({ v: 1, fn: "fund", pool: POOL, amount: "100" }));
    expect(env).toEqual({ req: { fn: "fund", pool: POOL, amount: 1_000_000_000n } });
  });
  it("returns null without a request", () => {
    expect(parseHash("")).toBeNull();
    expect(parseHash("#other=1")).toBeNull();
  });
  it("rejects a damaged fragment", () => {
    expect(() => parseHash("#r=%%%")).toThrow(RequestError);
  });
  it("needs v: 1 and a known action", () => {
    expect(() => parseRequest({ fn: "create_pool" })).toThrow(/version/);
    expect(() => parseRequest({ v: 1, fn: "close_pool" })).toThrow(/Unknown action/);
    expect(() => parseRequest({ v: 1, fn: "__proto__" })).toThrow(/Unknown action/);
  });
});

suite("result delivery", () => {
  it("accepts a local or https callback and an id on any action", () => {
    expect(parseEnvelope({ v: 1, fn: "create_pool", callback: "http://127.0.0.1:8787/", id: "k-1" }))
      .toEqual({ req: { fn: "create_pool" }, callback: "http://127.0.0.1:8787/", id: "k-1" });
    expect(parseEnvelope({ v: 1, fn: "fund", pool: POOL, amount: "1", callback: "https://agent.example/hook" }).callback).toBe("https://agent.example/hook");
    expect(callbackUrl("http://localhost:9000/x")).toBe("http://localhost:9000/x");
  });
  it("refuses plain http to other machines, credentials, and odd ids", () => {
    expect(() => callbackUrl("http://192.168.1.5:8787/")).toThrow(/this machine/);
    expect(() => callbackUrl("http://evil.example/")).toThrow(/this machine/);
    expect(() => callbackUrl("javascript:alert(1)")).toThrow(/this machine/);
    expect(() => callbackUrl("https://u:p@agent.example/")).toThrow(/credentials/);
    expect(() => callbackUrl("not a url")).toThrow(/must be a URL/);
    expect(() => parseEnvelope({ v: 1, fn: "create_pool", id: "a b" })).toThrow(/"id"/);
  });
});

suite("the link cannot choose code or contracts", () => {
  for (const field of ["policy", "verifier", "usdc", "pool_wasm_hash", "owner", "source"]) {
    it(`refuses "${field}"`, () => {
      expect(() => parseRequest({ v: 1, fn: "create_pool", [field]: "x" })).toThrow(/does not accept/);
    });
  }
  it("refuses unknown create_agent fields such as calls", () => {
    expect(() => parseRequest(agentReq({ calls: [] }))).toThrow(/does not accept "calls"/);
  });
});

suite("amounts", () => {
  it("converts USDC to 7-decimal base units exactly", () => {
    expect(usdc("100", "a", true)).toBe(1_000_000_000n);
    expect(usdc("0.0000001", "a", true)).toBe(1n);
    expect(usdc(0.25, "a", true)).toBe(2_500_000n);
  });
  it("rejects bad amounts", () => {
    for (const bad of ["-1", "1e3", "0.00000001", "abc", "", null, 1e21]) {
      expect(() => usdc(bad, "a", true), String(bad)).toThrow(RequestError);
    }
    expect(() => usdc("0", "a", true)).toThrow(/above 0/);
    expect(usdc("0", "a", false)).toBe(0n);
  });
  it("formats for people", () => {
    expect(formatUsdc(1_000_000_000n)).toBe("100.00 USDC");
    expect(formatUsdc(2_500_000n)).toBe("0.25 USDC");
    expect(formatUsdc(1n)).toBe("0.0000001 USDC");
  });
});

suite("create_agent", () => {
  it("accepts a G… key and converts it to hex", () => {
    const r = parseRequest(agentReq());
    expect(r).toMatchObject({ fn: "create_agent", agentKey: agentKp.publicKey(), agentPubkeyHex: agentKp.rawPublicKey().toString("hex"), drawLimit: 100_000_000n });
  });
  it("accepts a hex key", () => {
    const hex = agentKp.rawPublicKey().toString("hex");
    expect(parseRequest(agentReq({ agent_key: hex.toUpperCase() }))).toMatchObject({ agentPubkeyHex: hex, agentKey: agentKp.publicKey() });
  });
  it("refuses a secret key with a clear warning", () => {
    expect(() => parseRequest(agentReq({ agent_key: agentKp.secret() }))).toThrow(/SECRET/);
  });
  it("refuses muxed and malformed payees, duplicates and overlaps", () => {
    const muxed = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ";
    expect(() => parseRequest(agentReq({ providers: [muxed] }))).toThrow(/muxed/);
    expect(() => parseRequest(agentReq({ providers: [PROVIDER, PROVIDER] }))).toThrow(/twice/);
    expect(() => parseRequest(agentReq({ recipients: [PROVIDER], recipient_per_transfer_cap: "1", recipient_total_cap: "1" }))).toThrow(/both lists/);
  });
  it("checks caps against their lists", () => {
    expect(() => parseRequest(agentReq({ provider_per_transfer_cap: "11" }))).toThrow(/above provider_total_cap/);
    expect(() => parseRequest(agentReq({ provider_per_transfer_cap: "0" }))).toThrow(/above 0/);
    expect(() => parseRequest(agentReq({ recipient_total_cap: "5" }))).toThrow(/list is empty/);
    expect(() => parseRequest(agentReq({ providers: [], provider_per_transfer_cap: "0", provider_total_cap: "0" }))).toThrow(/at least one/);
  });
  it("allows recipients that are other agents' wallets (C…)", () => {
    const r = parseRequest(agentReq({ recipients: [RECIPIENT], recipient_per_transfer_cap: "1", recipient_total_cap: "2" }));
    expect(r).toMatchObject({ recipients: [RECIPIENT], recipientTotalCap: 20_000_000n });
  });
  it("bounds expiry", () => {
    expect(parseRequest(agentReq({ expiry_hours: undefined }))).toMatchObject({ expiryHours: 24 });
    expect(() => parseRequest(agentReq({ expiry_hours: 0 }))).toThrow(/expiry_hours/);
    expect(() => parseRequest(agentReq({ expiry_hours: 721 }))).toThrow(/expiry_hours/);
    expect(ledgerFromHours(1000, 1)).toBe(1720);
  });
  it("shows every payee and cap in the summary", () => {
    const s = describe(parseRequest(agentReq()));
    const text = JSON.stringify(s);
    expect(s.title).toContain("10.00 USDC");
    expect(text).toContain(PROVIDER);
    expect(text).toContain("0.50 USDC per payment");
  });
});

suite("other actions", () => {
  it("parses pool and agent actions; the owner comes from the wallet", () => {
    expect(parseRequest({ v: 1, fn: "revoke", pool: POOL, agent: AGENT })).toEqual({ fn: "revoke", pool: POOL, agent: AGENT });
    expect(parseRequest({ v: 1, fn: "return_funds", pool: POOL, agent: AGENT, amount: "1" })).toEqual({ fn: "return_funds", pool: POOL, agent: AGENT, amount: 10_000_000n });
    expect(() => parseRequest({ v: 1, fn: "revoke", pool: POOL, agent: AGENT, by: PROVIDER })).toThrow(/does not accept "by"/);
    expect(() => parseRequest({ v: 1, fn: "fund", pool: PROVIDER, amount: "1" })).toThrow(/contract address/);
  });
});
