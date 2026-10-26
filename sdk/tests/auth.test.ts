import { describe, expect, it, vi } from "vitest";
import { buildAuthorizationEntryPreimage, hash, Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import { agentCredentials, authDigest, onlyAgentEntry, signAgentAuthorization, signAgentEntry } from "../src/index.js";
import { AGENT, agentKey, entry, owner, VERIFIER } from "./fixtures.js";

describe("custom account authorization", () => {
  it("preserves the Rust/OZ digest vector", () => {
    expect(authDigest("CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ", Buffer.alloc(32, 7), [0]).toString("hex")).toBe("0930fda6066fc480420923a8ddd91d71a98708a6b59f617ec8b61514699416a0");
  });
  it.each(["legacy", "v2"])("supports %s credentials without changing the original", async (kind) => {
    const unsigned = entry(undefined, kind);
    const before = unsigned.toXDR("base64");
    const callback = vi.fn((digest: Uint8Array) => agentKey.sign(Buffer.from(digest)));
    const signed = await signAgentAuthorization(unsigned, { agent: AGENT, verifier: VERIFIER, networkPassphrase: Networks.TESTNET, expirationLedger: 160, signer: { publicKey: agentKey.rawPublicKey().toString("hex"), sign: callback } });
    expect(unsigned.toXDR("base64")).toBe(before);
    expect(signed.credentials().switch().name).toBe(unsigned.credentials().switch().name);
    expect(agentCredentials(signed).signatureExpirationLedger()).toBe(160);
    const hostPayload = hash(buildAuthorizationEntryPreimage(signed, 160, Networks.TESTNET).toXDR());
    const digest = authDigest(AGENT, hostPayload, [0]);
    const sig = agentCredentials(signed).signature().map()![1].val().map()![0].val().bytes();
    expect(agentKey.verify(digest, Buffer.from(sig))).toBe(true);
    const otherNetwork = authDigest(AGENT, hash(buildAuthorizationEntryPreimage(signed, 160, Networks.PUBLIC).toXDR()), [0]);
    expect(agentKey.verify(otherNetwork, Buffer.from(sig))).toBe(false);
    expect(callback.mock.calls[0][0]).toEqual(digest);
  });
  it("refuses source-account or another account's authorization before calling the signer", () => {
    const signer = vi.fn();
    expect(() => onlyAgentEntry(entry(undefined, "source"), AGENT, signer)).toThrow(/unsupported/);
    expect(() => onlyAgentEntry(entry(undefined, "v2", owner.publicKey()), AGENT, signer)).toThrow(/not the agent/);
    expect(signer).not.toHaveBeenCalled();
  });
  it("rejects an invalid signature from an external signer", async () => {
    await expect(signAgentAuthorization(entry(), { agent: AGENT, verifier: VERIFIER, networkPassphrase: Networks.TESTNET, expirationLedger: 160, signer: { publicKey: agentKey.rawPublicKey().toString("hex"), sign: () => Buffer.alloc(64) } })).rejects.toThrow(/invalid signature/);
  });
  it("rejects an expired-shaped authorization bound", () => {
    expect(() => signAgentEntry(entry(), { verifier: VERIFIER, secret: agentKey.secret(), networkPassphrase: Networks.TESTNET, expirationLedger: 0 })).toThrow(/expiry/);
  });
  it("handles V2 with the explicit caller-held key compatibility helper", () => {
    const signed = signAgentEntry(entry(undefined, "v2"), { verifier: VERIFIER, secret: agentKey.secret(), networkPassphrase: Networks.TESTNET, expirationLedger: 200 });
    expect(signed.credentials().switch().name).toBe("sorobanCredentialsAddressV2");
    expect(agentCredentials(signed).signature().switch().name).toBe("scvMap");
  });
  it("does not accept a signature made with a different key", async () => {
    const wrong = Keypair.random();
    await expect(signAgentAuthorization(entry(), { agent: AGENT, verifier: VERIFIER, networkPassphrase: Networks.TESTNET, expirationLedger: 160, signer: { publicKey: agentKey.rawPublicKey().toString("hex"), sign: (digest) => wrong.sign(Buffer.from(digest)) } })).rejects.toThrow(/invalid signature/);
  });
});
