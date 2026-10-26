import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Address, scValToNative } from "@stellar/stellar-sdk";
import { buildOwnerOp } from "@/lib/owner";
import { runPoolRecovery, withdrawable } from "@/lib/pool-recovery";
import type { State } from "@/lib/client";

const POOL = "CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR";
const VAULT = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const wasm = Buffer.from("test-only provider bytes");
const hash = createHash("sha256").update(wasm).digest("hex");
const mocks = vi.hoisted(() => ({ deployment: {} as Record<string, unknown>, pool: vi.fn(), yield: vi.fn(), read: vi.fn(), wasm: vi.fn(), ledger: vi.fn() }));
vi.mock("@/lib/deployments", () => ({ deployments: () => mocks.deployment }));
vi.mock("@/lib/contracts", () => ({ readPool: mocks.pool, readYield: mocks.yield, simulateRead: mocks.read }));
vi.mock("@/lib/stellar", () => ({ rpcServer: () => ({ getContractWasmByContractId: mocks.wasm, getLatestLedger: mocks.ledger }), withRetry: (fn: () => unknown) => fn() }));
import { configuredVaults, minimumOutput, positiveUnits, quoteYield, requireListedVault, verifyVault } from "@/lib/yield";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.deployment = { network: "testnet", yield_vaults: [{ name: "Test vault", vault: VAULT, usdc: USDC, wasm_hash: hash }] };
  mocks.pool.mockResolvedValue({ owner: "owner", usdc: USDC, accounting_version: 3, closed: false, balance: 100_000_000n });
  mocks.yield.mockResolvedValue({ vault: VAULT, shares: 50_000_000n, valuation_ok: true });
  mocks.wasm.mockResolvedValue(wasm);
  mocks.ledger.mockResolvedValue({ sequence: 1000 });
  mocks.read.mockImplementation(async (_id, fn, args) => {
    if (fn === "get_assets") return [{ address: USDC }];
    if (fn === "decimals") return 7;
    if (fn === "total_supply") return 100_000_000n;
    if (fn === "get_asset_amounts_per_shares") return [(scValToNative(args[0]) as bigint) * 2n];
    throw new Error(`unexpected ${fn}`);
  });
});

describe("reviewed vault activation", () => {
  it("is disabled by default and on a non-testnet deployment", async () => {
    mocks.deployment = { network: "testnet" };
    expect(configuredVaults(USDC)).toEqual([]);
    await expect(requireListedVault(VAULT, USDC, hash)).rejects.toThrow("No reviewed matching vault");
    expect(mocks.wasm).not.toHaveBeenCalled();
    mocks.deployment = { network: "mainnet", yield_vaults: [{ vault: VAULT, usdc: USDC, wasm_hash: hash }] };
    expect(configuredVaults(USDC)).toEqual([]);
  });
  it("requires the exact token contract, not the USDC label", async () => {
    expect(configuredVaults(VAULT)).toEqual([]);
    await expect(requireListedVault(VAULT, VAULT)).rejects.toThrow("No reviewed matching vault");
  });
  it("verifies the live code and single asset before enabling", async () => {
    await expect(requireListedVault(VAULT, USDC, hash)).resolves.toMatchObject({ vault: VAULT });
    expect(mocks.wasm).toHaveBeenCalledWith(VAULT);
    await expect(requireListedVault(VAULT, USDC, "0".repeat(64))).rejects.toThrow("No reviewed matching vault");
  });
  it("rejects upgraded code", async () => {
    mocks.wasm.mockResolvedValue(Buffer.from("changed"));
    await expect(verifyVault(VAULT, USDC, hash)).rejects.toThrow("code changed");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([[{ address: VAULT }], [{ address: USDC }, { address: VAULT }], []])("rejects wrong/multiple/missing assets: %j", async (...assets) => {
    mocks.read.mockImplementation(async (_id, fn) => fn === "decimals" ? 7 : assets);
    await expect(verifyVault(VAULT, USDC, hash)).rejects.toThrow("exactly this pool");
  });
  it("rejects shares with unsupported decimals", async () => {
    mocks.read.mockImplementation(async (_id, fn) => fn === "decimals" ? 18 : [{ address: USDC }]);
    await expect(verifyVault(VAULT, USDC, hash)).rejects.toThrow("7-decimal");
  });
});

describe("protected read-only yield quotes", () => {
  it("quotes USDC to shares at the vault exchange rate, not one-to-one", async () => {
    const q = await quoteYield(POOL, "invest", "10000000");
    expect(q).toMatchObject({ fn: "invest", unit: "shares", expected: "5000000", minimum: "4975000", validUntil: 1060,
      args: { amount: "10000000", min_shares: "4975000", valid_until: 1060 } });
  });
  it("quotes existing shares in underlying units without withdrawal", async () => {
    expect(await quoteYield(POOL, "lock_shares", "10000000")).toMatchObject({ unit: "USDC", expected: "20000000", minimum: "19900000" });
    expect(mocks.read.mock.calls.every((c) => !["withdraw", "deposit", "transfer"].includes(c[1]))).toBe(true);
  });
  it("does not strand redemptions when an integration is delisted", async () => {
    mocks.deployment = { network: "testnet" };
    await expect(quoteYield(POOL, "redeem_shares", "10000000")).resolves.toMatchObject({ fn: "redeem_shares" });
    await expect(quoteYield(POOL, "invest", "10000000")).rejects.toThrow("No reviewed matching vault");
    await expect(quoteYield(POOL, "lock_shares", "10000000")).rejects.toThrow("No reviewed matching vault");
  });
  it("rejects cash-only pools, closed pools and unavailable valuations", async () => {
    mocks.pool.mockResolvedValueOnce({ accounting_version: 2 });
    await expect(quoteYield(POOL, "invest", "1")).rejects.toThrow("newly deployed v3");
    mocks.pool.mockResolvedValueOnce({ accounting_version: 3, closed: true });
    await expect(quoteYield(POOL, "lock_shares", "10000")).rejects.toThrow("permanently closed");
    mocks.yield.mockResolvedValueOnce({ vault: VAULT, valuation_ok: false });
    await expect(quoteYield(POOL, "invest", "10000")).rejects.toThrow("valuation unavailable");
  });
  it("rejects more than available cash or shares", async () => {
    await expect(quoteYield(POOL, "invest", "100000001")).rejects.toThrow("liquid USDC");
    await expect(quoteYield(POOL, "redeem_shares", "50000001")).rejects.toThrow("share balance");
  });
  it("refuses to bootstrap an empty vault", async () => {
    const original = mocks.read.getMockImplementation()!;
    mocks.read.mockImplementation((...args) => args[1] === "total_supply" ? 0n : original(...args));
    await expect(quoteYield(POOL, "invest", "10000")).rejects.toThrow("initialized, seeded");
  });
  it("rejects unsafe inputs and zero minimum outputs", () => {
    for (const input of ["0", "-1", "1.2", "1e7", 1, (1n << 127n).toString()]) expect(() => positiveUnits(input)).toThrow();
    expect(() => minimumOutput(1n)).toThrow("too small");
  });
});

describe("owner-signed operations and recovery", () => {
  it("encodes the pool entrypoints with exact bounds and no allowance", () => {
    for (const [fn, args] of [
      ["configure_yield", { vault: VAULT, wasm_hash: hash }],
      ["invest", { amount: "10000", min_shares: "9950", valid_until: 1060 }],
      ["lock_shares", { shares: "10000", min_assets: "9950", valid_until: 1060 }],
      ["redeem_shares", { shares: "10000", min_assets: "9950", valid_until: 1060 }],
      ["release_shares", { shares: "10000" }],
    ] as const) {
      const op = buildOwnerOp(POOL, fn, args).body().invokeHostFunctionOp();
      const invocation = op.hostFunction().invokeContract();
      expect(Address.fromScAddress(invocation.contractAddress()).toString()).toBe(POOL);
      expect(invocation.functionName().toString()).toBe(fn);
      expect(invocation.args()).toHaveLength(Object.keys(args).length);
      expect(op.auth()).toHaveLength(0);
    }
  });
  it("rejects unbounded minima and malformed deadlines before simulation", () => {
    expect(() => buildOwnerOp(POOL, "invest", { amount: "1", min_shares: "0", valid_until: 2 })).toThrow("positive");
    expect(() => buildOwnerOp(POOL, "redeem_shares", { shares: "1", min_assets: "1", valid_until: -1 })).toThrow("expiry");
  });
  it("can close a v3 pool whose remaining backing is shares, not cash", async () => {
    const state: State = { ids: { pool: POOL, owner: "owner", usdc: USDC, policy: POOL, verifier: POOL }, latestLedger: 1, agents: [],
      pool: { owner: "owner", usdc: USDC, locked: "90000", sum_limits: "0", balance: "0", outstanding: "0", agent_count: 0, closed: false, accounting_version: 3 },
      yield: { vault: VAULT, shares: "100000", share_balance_ok: true, share_decimals: 7, estimated_assets: "100000", budget_backing: "90000", backing_bps: 9000, valuation_ok: true } };
    expect(withdrawable(state)).toBe(0n); // NAV is never presented as liquid cash
    const run = vi.fn(async (step) => { expect(step.fn).toBe("close_pool"); expect(step.label).toContain("in kind"); state.pool.closed = true; });
    const result = await runPoolRecovery({ mode: "close", pool: POOL, owner: "owner", read: async () => state, run });
    expect(result.transactions).toBe(1);
  });
});
