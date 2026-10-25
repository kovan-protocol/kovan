import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { defaultKeystore } from "@/lib/keystore";
import { agentSigning } from "@/lib/key-access";

const mocks = vi.hoisted(() => ({ readPool: vi.fn(), simulateRead: vi.fn(), onchainSigner: vi.fn(), assertPool: vi.fn() }));
vi.mock("@/lib/contracts", () => ({ readPool: mocks.readPool, simulateRead: mocks.simulateRead, addr: (x: string) => x }));
vi.mock("@/lib/agent", () => ({ onchainSigner: mocks.onchainSigner }));
vi.mock("@/lib/stellar", async (actual) => ({
  ...await actual<typeof import("@/lib/stellar")>(),
  assertKovanPool: mocks.assertPool,
  ids: (pool?: string) => ({ pool, verifier: StrKey.encodeContract(Buffer.alloc(32, 3)) }),
}));
import { GET, POST } from "@/app/api/agent/keys/route";

const pool = StrKey.encodeContract(Buffer.alloc(32, 1));
const agent = StrKey.encodeContract(Buffer.alloc(32, 2));
const verifier = StrKey.encodeContract(Buffer.alloc(32, 3));
const otherPool = StrKey.encodeContract(Buffer.alloc(32, 4));
const owner = Keypair.random();
let directory: string;

function post(body: Record<string, unknown>) {
  return POST(new Request("https://kovan.example/api/agent/keys", { method: "POST", headers: { "content-type": "application/json", origin: "https://kovan.example", host: "kovan.example" }, body: JSON.stringify(body) }));
}

async function generate() {
  const response = await post({ action: "generate-challenge", owner: owner.publicKey(), pool });
  expect(response.status).toBe(200);
  const challenge = await response.json();
  const result = await post({ action: "generate", challengeId: challenge.id, signature: owner.signMessage(challenge.message).toString("base64") });
  expect(result.status).toBe(200);
  return result.json();
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "kovan-key-route-"));
  vi.stubEnv("KOVAN_KEYSTORE", path.join(directory, "agents.json"));
  vi.resetAllMocks();
  mocks.readPool.mockResolvedValue({ owner: owner.publicKey() });
  mocks.simulateRead.mockResolvedValue({});
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("managed and external signer keys", () => {
  it("binds generated keys to the verified wallet and keeps public responses free of secrets", async () => {
    const info = await generate();
    expect(info.owner).toBe(owner.publicKey());
    expect(info).not.toHaveProperty("secret");
    const list = await GET();
    expect(JSON.stringify(await list.json())).not.toContain('"secret"');
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(agentSigning(info.pubkeyHex, owner.publicKey(), defaultKeystore().list())).toMatchObject({ mode: "managed", exportable: true });
  });

  it("exports only after the owner signs, retains the app's copy, and refuses replay", async () => {
    const info = await generate();
    mocks.onchainSigner.mockResolvedValue({ verifier, pubkeyHex: info.pubkeyHex });
    const challengeResponse = await post({ action: "export-challenge", owner: owner.publicKey(), pool, agent });
    expect(challengeResponse.status).toBe(200);
    const c = await challengeResponse.json();
    const proof = { action: "export", challengeId: c.id, signature: owner.signMessage(c.message).toString("base64") };
    const response = await post(proof);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const result = await response.json();
    expect(Keypair.fromSecret(result.secret).publicKey()).toBe(info.publicKey);
    expect(defaultKeystore().secretForPubkeyHex(info.pubkeyHex)).toBe(result.secret);
    expect(result.agent).toBe(agent);
    expect((await post(proof)).status).toBe(403);
  });

  it("does not let an attacker export a victim's key by registering its public key in another pool", async () => {
    const info = await generate();
    const attacker = Keypair.random();
    mocks.readPool.mockResolvedValue({ owner: attacker.publicKey() });
    mocks.onchainSigner.mockResolvedValue({ verifier, pubkeyHex: info.pubkeyHex });
    const response = await post({ action: "export-challenge", owner: attacker.publicKey(), pool: otherPool, agent });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(defaultKeystore().secretForPubkeyHex(info.pubkeyHex)!);
    expect(agentSigning(info.pubkeyHex, attacker.publicKey(), defaultKeystore().list()).exportable).toBe(false);
  });

  it("rejects unverified generation and signatures from a different wallet", async () => {
    expect((await post({ label: "old unsigned request" })).status).toBe(400);
    const c = await (await post({ action: "generate-challenge", owner: owner.publicKey(), pool })).json();
    const response = await post({ action: "generate", challengeId: c.id, signature: Keypair.random().signMessage(c.message).toString("base64") });
    expect(response.status).toBe(403);
    expect(defaultKeystore().list()).toHaveLength(0);
  });

  it("rechecks on-chain ownership and membership after signing", async () => {
    const info = await generate();
    mocks.onchainSigner.mockResolvedValue({ verifier, pubkeyHex: info.pubkeyHex });
    const c = await (await post({ action: "export-challenge", owner: owner.publicKey(), pool, agent })).json();
    mocks.simulateRead.mockRejectedValue(new Error("UnknownAgent"));
    const response = await post({ action: "export", challengeId: c.id, signature: owner.signMessage(c.message).toString("base64") });
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain(defaultKeystore().secretForPubkeyHex(info.pubkeyHex)!);
  });

  it("keeps external keys external and refuses to invent ownership for legacy local keys", async () => {
    const external = Keypair.random().rawPublicKey().toString("hex");
    expect(agentSigning(external, owner.publicKey(), [])).toMatchObject({ mode: "external", exportable: false });
    const legacy = defaultKeystore().generate("legacy");
    mocks.onchainSigner.mockResolvedValue({ verifier, pubkeyHex: legacy.pubkeyHex });
    expect((await post({ action: "export-challenge", owner: owner.publicKey(), pool, agent })).status).toBe(403);
    expect(() => defaultKeystore().exportForOwner(legacy.pubkeyHex, owner.publicKey())).toThrow(/not available/);
    expect(agentSigning(legacy.pubkeyHex, owner.publicKey(), defaultKeystore().list())).toMatchObject({ mode: "managed", exportable: false });
  });

  it("refuses cross-site export requests before chain or keystore access", async () => {
    const response = await POST(new Request("https://kovan.example/api/agent/keys", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ action: "export" }) }));
    expect(response.status).toBe(403);
    expect(mocks.readPool).not.toHaveBeenCalled();
  });
});
