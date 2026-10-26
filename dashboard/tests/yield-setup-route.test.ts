import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, Networks } from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({ source: { usdc: "fixed-token" }, prepare: vi.fn(), activate: vi.fn(), receipt: vi.fn(), inspect: vi.fn(), status: vi.fn(), listed: vi.fn(), rpc: {} }));
vi.mock("@/lib/native-yield", () => ({ nativeYieldSource: () => mocks.source }));
vi.mock("@/lib/deployments", () => ({ deployments: () => ({ network: "testnet" }) }));
vi.mock("@/lib/stellar", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/stellar")>(), rpcServer: () => mocks.rpc }));
vi.mock("@kovan-protocol/sdk/experimental", () => ({ prepareNativeVault: mocks.prepare, prepareActivateNativeVault: mocks.activate, nativeVaultFromReceipt: mocks.receipt, inspectYieldVault: mocks.inspect, reviewedYieldVaults: mocks.listed }));
vi.mock("@kovan-protocol/sdk", async importOriginal => ({ ...await importOriginal<typeof import("@kovan-protocol/sdk")>(), transactionStatus: mocks.status }));
import { POST } from "@/app/api/yield/setup/route";
const manager = Keypair.random().publicKey();
const hash = "a".repeat(64);
const vault = { vault: "verified-vault", wasm_hash: "pinned-hash" };
const post = (body: unknown, extra = {}) => POST(new Request("http://localhost/api/yield/setup", { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.receipt.mockResolvedValue(vault);
  mocks.inspect.mockResolvedValue({ invested_amount: 0n, idle_amount: 10000000n, hasActiveAllocation: false });
  mocks.listed.mockReturnValue([]);
  mocks.prepare.mockResolvedValue({ xdr: "unsigned", hash, preview: "not-a-receipt" });
  mocks.activate.mockResolvedValue({ xdr: "unsigned-invest", hash });
});
describe("XOXNO wallet setup", () => {
  it("builds only from the operator-selected source and omits the simulation preview", async () => {
    const res = await post({ action: "create", manager, amount: "10000000" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ xdr: "unsigned", hash });
    expect(mocks.prepare).toHaveBeenCalledWith({ rpc: mocks.rpc, networkPassphrase: Networks.TESTNET }, mocks.source, manager, "10000000");
  });
  it.each([{ source: {} }, { vault: "arbitrary" }, { strategy: "arbitrary" }])("rejects target substitutions: %j", async extra => {
    expect((await post({ action: "create", manager, amount: "1", ...extra })).status).toBe(422);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("refuses cross-site creation", async () => {
    expect((await post({ action: "create", manager }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("requires a committed matching receipt before activation", async () => {
    mocks.receipt.mockRejectedValueOnce(new Error("creation NOT_FOUND; reconcile"));
    expect((await post({ action: "activate", manager, creationHash: hash, amount: "1" })).status).toBe(422);
    expect(mocks.activate).not.toHaveBeenCalled();
    expect((await post({ action: "activate", manager, creationHash: hash, amount: "1" })).status).toBe(200);
    expect(mocks.activate).toHaveBeenCalledWith(expect.anything(), vault, manager, "1");
  });
  it("reports idle state without enabling it or writing a registry", async () => {
    const res = await post({ action: "inspect", manager, creationHash: hash });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ enabled: false, state: { invested_amount: "0", hasActiveAllocation: false } });
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("reconciles unknown submissions without preparing another transaction", async () => {
    mocks.status.mockResolvedValue({ hash, status: "NOT_FOUND" });
    expect(await (await post({ action: "transaction", hash })).json()).toEqual({ hash, status: "NOT_FOUND" });
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.activate).not.toHaveBeenCalled();
  });
});
