import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ prepare: vi.fn(), submit: vi.fn(), status: vi.fn(), sign: vi.fn(), owner: "fixture-owner" }));
vi.mock("../src/chain", () => ({
  client: { submit: mock.submit }, prepare: mock.prepare,
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  explorerTx: (x: string) => x, explorerContract: (x: string) => x,
}));
vi.mock("@stellar/freighter-api", () => ({
  getNetwork: async () => ({ networkPassphrase: "Test SDF Network ; September 2015" }),
  isConnected: async () => ({ isConnected: true }), requestAccess: async () => ({ address: mock.owner }), signTransaction: mock.sign,
}));
vi.mock("@kovan-protocol/sdk", async original => ({
  ...await original<object>(), transactionStatus: mock.status,
  signPrepared: async (_prepared: unknown, sign: (x: string, c: unknown) => unknown) => sign("unsigned", { networkPassphrase: "Test SDF Network ; September 2015", address: mock.owner }),
}));
vi.mock("../src/appearance", () => ({}));

class Element {
  hidden = false; disabled = false; textContent = ""; dataset = {};
  classList = { add() {} };
  listeners = new Map<string, () => unknown>();
  append() {} replaceChildren() {} querySelectorAll() { return []; }
  addEventListener(event: string, fn: () => unknown) { this.listeners.set(event, fn); }
}
const hash = "1".repeat(64);
const link = "#r=" + Buffer.from(JSON.stringify({ v: 1, fn: "create_pool" })).toString("base64url");
let nodes: Map<string, Element>, saved: Map<string, string>;
let storage: { getItem: (k: string) => string | null; setItem: ReturnType<typeof vi.fn>; removeItem: (k: string) => void };
const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!; };
const event = (id: string) => node(id).listeners.get("click")!();
async function open() {
  vi.resetModules(); nodes = new Map();
  vi.stubGlobal("document", { getElementById: node, createElement: () => new Element() });
  vi.stubGlobal("window", new Element());
  vi.stubGlobal("location", { hash: link });
  vi.stubGlobal("localStorage", storage);
  await import("../src/main");
  await event("connect");
}
beforeEach(() => {
  vi.clearAllMocks(); saved = new Map(); mock.owner = "fixture-owner";
  storage = { getItem: k => saved.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { saved.set(k, v); }), removeItem: k => { saved.delete(k); } };
  mock.prepare.mockReset().mockResolvedValue({ hash, xdr: "unsigned" });
  mock.sign.mockReset().mockResolvedValue({ signedTxXdr: "same-signed-envelope" });
  mock.submit.mockReset().mockResolvedValue({ hash, status: "NOT_FOUND" });
  mock.status.mockReset().mockResolvedValue({ hash, status: "NOT_FOUND" });
});

describe("single-action signing journal", () => {
  it("persists before broadcast and reconciles a reload without signing again", async () => {
    mock.submit.mockImplementation(async () => {
      expect(JSON.parse(saved.get("kovan-pending:" + link)!)).toEqual({ hash, xdr: "same-signed-envelope", owner: mock.owner });
      return { hash, status: "NOT_FOUND" };
    });
    await open(); await event("sign");
    await open(); mock.status.mockResolvedValue({ hash, status: "SUCCESS", returnValue: "pool" }); await event("sign");
    expect(mock.prepare).toHaveBeenCalledTimes(1); expect(mock.sign).toHaveBeenCalledTimes(1); expect(mock.submit).toHaveBeenCalledTimes(1);
    expect(saved.has("kovan-pending:" + link)).toBe(false);
    expect(saved.get("kovan-signed:" + link)).toBe(hash);
    await open(); await event("sign");
    expect(mock.prepare).toHaveBeenCalledTimes(1);
  });
  it("retries only the original envelope after an unknown submission", async () => {
    await open(); await event("sign"); await event("sign");
    expect(mock.prepare).toHaveBeenCalledTimes(1);
    expect(mock.submit.mock.calls).toEqual([["same-signed-envelope"], ["same-signed-envelope"]]);
  });
  it("never broadcasts if storage fails", async () => {
    await open(); storage.setItem.mockImplementation(() => { throw new Error("storage full"); }); await event("sign");
    expect(mock.submit).not.toHaveBeenCalled();
    expect(node("status").textContent).toContain("storage full");
  });
  it("preserves a transport failure and binds resumption to the signing wallet", async () => {
    mock.submit.mockRejectedValue(new Error("connection lost"));
    await open(); await event("sign");
    expect(saved.has("kovan-pending:" + link)).toBe(true);
    mock.owner = "another-owner"; await open(); await event("sign");
    expect(node("status").textContent).toContain("Reconnect");
    expect(mock.submit).toHaveBeenCalledTimes(1); expect(mock.prepare).toHaveBeenCalledTimes(1);
  });
  it("only a confirmed failure permits preparing a new transaction", async () => {
    await open(); await event("sign");
    mock.status.mockResolvedValue({ hash, status: "FAILED", error: "txFailed" }); await event("sign");
    expect(saved.size).toBe(0);
    await event("sign"); expect(mock.prepare).toHaveBeenCalledTimes(2);
  });
});
