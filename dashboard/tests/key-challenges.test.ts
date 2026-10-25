import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { KeyChallenges } from "@/lib/key-challenges";

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "kovan-key-auth-")); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

describe("signer key authorizations", () => {
  const owner = Keypair.random();
  const scope = { owner: owner.publicKey(), pool: StrKey.encodeContract(Buffer.alloc(32, 1)), origin: "https://kovan.example", intent: "generate" as const };

  it("accepts the owner's SEP-53 signature once, including across worker restarts", () => {
    const c = new KeyChallenges(directory).create(scope);
    const sig = owner.signMessage(c.message).toString("base64");
    expect(new KeyChallenges(directory).consume(c.id, sig, "generate", scope.origin).owner).toBe(scope.owner);
    expect(() => new KeyChallenges(directory).consume(c.id, sig, "generate", scope.origin)).toThrow(/already used/);
  });

  it("rejects another wallet without consuming the owner's challenge", () => {
    const store = new KeyChallenges(directory);
    const c = store.create(scope);
    expect(() => store.consume(c.id, Keypair.random().signMessage(c.message).toString("base64"), "generate", scope.origin)).toThrow(/pool owner/);
    expect(store.consume(c.id, owner.signMessage(c.message).toString("base64"), "generate", scope.origin).id).toBe(c.id);
  });

  it("rejects signatures over a changed message, a different intent, and a different origin", () => {
    const store = new KeyChallenges(directory);
    const c = store.create(scope);
    expect(() => store.consume(c.id, owner.signMessage(c.message + "changed").toString("base64"), "generate", scope.origin)).toThrow(/pool owner/);
    const sig = owner.signMessage(c.message).toString("base64");
    expect(() => store.consume(c.id, sig, "export", scope.origin)).toThrow(/does not match/);
    expect(() => store.consume(c.id, sig, "generate", "https://another.example")).toThrow(/does not match/);
  });

  it("expires at the boundary and refuses path traversal and malformed signatures", () => {
    let now = Date.now();
    const store = new KeyChallenges(directory, () => now);
    const c = store.create(scope);
    expect(() => store.consume(c.id, "invalid", "generate", scope.origin)).toThrow(/pool owner/);
    expect(() => store.consume("../../agents", "invalid", "generate", scope.origin)).toThrow(/missing/);
    now = c.expiresAt;
    expect(() => store.consume(c.id, owner.signMessage(c.message).toString("base64"), "generate", scope.origin)).toThrow(/expired/);
  });
});
