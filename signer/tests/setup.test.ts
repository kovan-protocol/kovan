import { beforeEach, describe, expect, it, vi } from "vitest";
import { Networks, StrKey } from "@stellar/stellar-sdk";

const mock = vi.hoisted(() => ({ prepare: vi.fn(), submit: vi.fn(), status: vi.fn(), sign: vi.fn() }));
vi.mock("../src/chain", () => ({
  client: { submit: mock.submit, read: vi.fn(async () => 100000000n), contracts: { usdc: "token" } },
  prepare: mock.prepare, NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  explorerTx: (x: string) => x, explorerContract: (x: string) => x,
}));
vi.mock("@stellar/freighter-api", () => ({
  getNetwork: async () => ({ networkPassphrase: "Test SDF Network ; September 2015" }),
  isConnected: async () => ({ isConnected: true }), requestAccess: async () => ({ address: "fixture-owner" }), signTransaction: mock.sign,
}));
vi.mock("@kovan-protocol/sdk", async original => ({
  ...await original<object>(), transactionStatus: mock.status,
  signPrepared: async (_prepared: unknown, sign: (x: string, c: unknown) => unknown) => sign("unsigned", { networkPassphrase: Networks.TESTNET, address: "fixture-owner" }),
}));
vi.mock("../src/appearance", () => ({}));

class Element {
  hidden = false; disabled = false; checked = false; value = ""; textContent = "";
  dataset = {}; files: { size: number; text: () => Promise<string> }[] = [];
  listeners = new Map<string, () => unknown>();
  append() {} replaceChildren() {} remove() {} click() {}
  addEventListener(event: string, fn: () => unknown) { this.listeners.set(event, fn); }
}
const pool = StrKey.encodeContract(Buffer.alloc(32, 7));
const hash = "1".repeat(64);
let search: string, nodes: Map<string, Element>, saved: Map<string, string>, backup: Blob;
let storage: { getItem: (k: string) => string | null; setItem: ReturnType<typeof vi.fn> };
const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!; };
const event = (id: string, name = "click") => node(id).listeners.get(name)!();
const progress = () => JSON.parse(saved.get("kovan-setup:" + search)!);
async function open() {
  vi.resetModules(); nodes = new Map();
  vi.stubGlobal("document", { getElementById: node, createElement: () => new Element(), body: new Element() });
  vi.stubGlobal("window", new Element());
  vi.stubGlobal("location", { search, origin: "https://fixture.invalid" });
  vi.stubGlobal("sessionStorage", storage);
  await import("../src/setup");
}
beforeEach(() => {
  vi.clearAllMocks(); saved = new Map();
  storage = { getItem: k => saved.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { saved.set(k, v); }) };
  search = `?pool=${pool}&fund=1`;
  mock.prepare.mockReset().mockResolvedValue({ hash, xdr: "unsigned" });
  mock.sign.mockReset().mockResolvedValue({ signedTxXdr: "same-signed-envelope" });
  mock.submit.mockReset().mockResolvedValue({ hash, status: "NOT_FOUND" });
  mock.status.mockReset().mockResolvedValue({ hash, status: "NOT_FOUND" });
  vi.stubGlobal("fetch", vi.fn(async () => ({})));
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { backup = blob as Blob; return "blob:fixture"; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("setup transaction journal", () => {
  it("persists before broadcast and reconciles success after reload without another signature", async () => {
    mock.submit.mockImplementation(async () => {
      expect(progress().pending).toEqual({ index: 0, hash, xdr: "same-signed-envelope" });
      return { hash, status: "NOT_FOUND" };
    });
    await open(); await event("connect"); await event("run");
    await open(); await event("connect");
    mock.status.mockResolvedValue({ hash, status: "SUCCESS" });
    await event("run");
    expect(mock.prepare).toHaveBeenCalledTimes(1);
    expect(mock.sign).toHaveBeenCalledTimes(1);
    expect(mock.submit).toHaveBeenCalledTimes(1);
    expect(progress().done).toEqual([true]);
    expect(progress().pending).toBeUndefined();
  });
  it("unknown retry resends only the exact signed envelope", async () => {
    await open(); await event("connect"); await event("run"); await event("run");
    expect(mock.prepare).toHaveBeenCalledTimes(1);
    expect(mock.submit.mock.calls).toEqual([["same-signed-envelope"], ["same-signed-envelope"]]);
    expect(progress().done).toEqual([false]);
  });
  it("keeps pending state after transport failures", async () => {
    mock.submit.mockRejectedValue(new Error("network lost"));
    await open(); await event("connect"); await event("run");
    expect(progress().pending.hash).toBe(hash);
    mock.status.mockResolvedValue({ hash, status: "SUCCESS" });
    await event("run");
    expect(mock.prepare).toHaveBeenCalledTimes(1);
    expect(progress().done).toEqual([true]);
  });
  it("never submits when the journal cannot be persisted, including retries", async () => {
    await open(); await event("connect");
    storage.setItem.mockImplementation(() => { throw new Error("storage full"); });
    await event("run"); await event("run");
    expect(mock.submit).not.toHaveBeenCalled();
  });
  it("does not silently restart corrupted saved progress", async () => {
    saved.set("kovan-setup:" + search, "{broken");
    await open();
    expect(node("status").textContent).toMatch(/Cannot safely resume/);
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("reconciles old unknown hashes without reconstructing their transaction", async () => {
    saved.set("kovan-setup:" + search, JSON.stringify({ done: [false], agents: [], txs: [hash] }));
    await open(); await event("connect"); await event("run");
    expect(mock.prepare).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
    expect(mock.status).toHaveBeenCalled();
  });
});

describe("setup key backup", () => {
  it("requires a backup before deployment and restores the same key after partial completion", async () => {
    search = `?pool=${pool}&agent=name:first,draw:0.1,pay:${pool},per:0.1,total:0.1&agent=name:second,draw:0.1,pay:${pool},per:0.1,total:0.1`;
    await open(); await event("connect"); await event("run");
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(node("status").textContent).toMatch(/backup/);
    await event("download");
    const backupText = await backup.text(); const downloaded = JSON.parse(backupText);
    expect(downloaded.agents).toHaveLength(2);
    for (const a of downloaded.agents) expect(JSON.stringify(progress())).not.toContain(a.secret);
    node("backup-confirm").checked = true; await event("backup-confirm", "change");
    mock.submit.mockResolvedValue({ hash, status: "SUCCESS", returnValue: "first-account" });
    mock.sign.mockResolvedValueOnce({ signedTxXdr: "first" }).mockRejectedValueOnce(new Error("Cancelled second approval"));
    await event("run");
    expect(progress().done).toEqual([true, false]);
    await open(); await event("connect"); await event("run");
    expect(node("status").textContent).toMatch(/Import/);
    expect(mock.prepare).toHaveBeenCalledTimes(2);
    node("import-keys").files = [{ size: backupText.length, text: async () => backupText }];
    await event("import-keys", "change");
    mock.submit.mockResolvedValue({ hash, status: "SUCCESS", returnValue: "second-account" });
    await event("run");
    expect(progress().done).toEqual([true, true]);
    expect(mock.prepare.mock.calls[2][0].agentKey).toBe(downloaded.agents[1].public_key);
  });
});
