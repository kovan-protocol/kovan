import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { Keystore } from "@/lib/keystore";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kovan-ks-")), "agents.json");
const files: string[] = [];
afterEach(() => files.forEach((f) => fs.rmSync(path.dirname(f), { recursive: true, force: true })));

describe("Keystore", () => {
  it("generates a key, returns only the public parts, and persists the secret with 0600", () => {
    const f = tmp(); files.push(f);
    const ks = new Keystore(f);
    const k = ks.generate("agent-1");
    expect(k.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(k.pubkeyHex).toHaveLength(64);
    expect(k).not.toHaveProperty("secret");
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(ks.secretForPubkeyHex(k.pubkeyHex)).toMatch(/^S[A-Z2-7]{55}$/);
  });
  it("finds the secret by on-chain pubkey hex across restarts", () => {
    const f = tmp(); files.push(f);
    const k = new Keystore(f).generate("x");
    const again = new Keystore(f);
    expect(Keypair.fromSecret(again.secretForPubkeyHex(k.pubkeyHex)!).rawPublicKey().toString("hex")).toBe(k.pubkeyHex);
  });
  it("returns null for unknown keys and lists public info only", () => {
    const f = tmp(); files.push(f);
    const ks = new Keystore(f);
    ks.generate("a");
    expect(ks.secretForPubkeyHex("00".repeat(32))).toBeNull();
    expect(ks.list().every((e) => !("secret" in e))).toBe(true);
  });
  it("can import an existing secret", () => {
    const f = tmp(); files.push(f);
    const kp = Keypair.random();
    const ks = new Keystore(f);
    const k = ks.importSecret("imported", kp.secret());
    expect(k.publicKey).toBe(kp.publicKey());
    expect(ks.secretForPubkeyHex(kp.rawPublicKey().toString("hex"))).toBe(kp.secret());
  });
});
