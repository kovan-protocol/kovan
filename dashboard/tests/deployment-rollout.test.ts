import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import type { Deployments } from "@/lib/deployments";
import { loadPools, POOLS_KEY } from "@/components/PoolSelector";

const config = vi.hoisted(() => ({ current: {} as Deployments }));
vi.mock("@/lib/deployments", () => ({ deployments: () => config.current }));
const CURRENT = "CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR";
const LEGACY = "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ";
const SAVED = "CBX5MTWP4S34CIOALLCAXNXW3GPE5W2BTZQWYLW3IZKQPUG3I75A5H4T";
const currentWasm = Buffer.from("current test wasm");
const legacyWasm = Buffer.from("legacy test wasm");
const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");

beforeEach(() => {
  vi.resetModules();
  for (const name of ["POOL_ID", "POLICY_ID", "VERIFIER_ID", "USDC_SAC_ID"]) vi.stubEnv(name, "");
  config.current = {
    network: "testnet", pool: CURRENT, pool_wasm_hash: hash(currentWasm),
    account_wasm_hash: "a".repeat(64), owner: "owner", usdc: "usdc", policy: "policy", verifier: "verifier",
    legacy_pools: [{ pool: LEGACY, pool_wasm_hash: hash(legacyWasm) }],
  };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("pool rollout trust and bindings", () => {
  it("accepts the current code after checking its hash", async () => {
    const read = vi.spyOn(rpc.Server.prototype, "getContractWasmByContractId").mockResolvedValue(currentWasm);
    const { assertKovanPool } = await import("@/lib/stellar");
    await assertKovanPool(CURRENT);
    expect(read).toHaveBeenCalledWith(CURRENT);
  });
  it("preserves recovery of the old default and browser-created legacy pools", async () => {
    vi.spyOn(rpc.Server.prototype, "getContractWasmByContractId").mockResolvedValue(legacyWasm);
    const { assertKovanPool } = await import("@/lib/stellar");
    await expect(assertKovanPool(LEGACY)).resolves.toBeUndefined();
    await expect(assertKovanPool(SAVED)).resolves.toBeUndefined();
  });
  it("rejects unknown code even if its address is the configured default", async () => {
    vi.spyOn(rpc.Server.prototype, "getContractWasmByContractId").mockResolvedValue(Buffer.from("untrusted"));
    const { assertKovanPool } = await import("@/lib/stellar");
    await expect(assertKovanPool(CURRENT)).rejects.toThrow("not a Kovan pool");
  });
  it("never uses the legacy wasm to create a new pool, even while viewing an old pool", async () => {
    const { ids, creationIds } = await import("@/lib/stellar");
    expect(ids(LEGACY)).toMatchObject({ pool: LEGACY, poolWasmHash: hash(legacyWasm), policy: "policy", verifier: "verifier" });
    expect(creationIds().poolWasmHash).toBe(hash(currentWasm));
  });
  it("does not trust a cached pool after its code is removed from the allowlist", async () => {
    const read = vi.spyOn(rpc.Server.prototype, "getContractWasmByContractId").mockResolvedValue(legacyWasm);
    const { assertKovanPool } = await import("@/lib/stellar");
    await assertKovanPool(LEGACY);
    config.current.legacy_pools = [];
    await expect(assertKovanPool(LEGACY)).rejects.toThrow("not a Kovan pool");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("separates current release creation from legacy reads and unknown legacy pools", async () => {
    config.current.current_release = { policy: "new-policy", verifier: "new-verifier", usdc: "usdc", account_wasm_hash: "b".repeat(64), pool_wasm_hash: "c".repeat(64), mandate_version: 1 };
    vi.spyOn(rpc.Server.prototype, "getContractWasmByContractId").mockResolvedValue(legacyWasm);
    const { ids, creationIds, assertKovanPool } = await import("@/lib/stellar");
    expect(creationIds()).toMatchObject({ policy: "new-policy", accountWasmHash: "b".repeat(64), mandateVersion: 1 });
    expect(ids(CURRENT).policy).toBe("policy");
    await assertKovanPool(SAVED);
    expect(ids(SAVED)).toMatchObject({ policy: "policy", poolWasmHash: hash(legacyWasm), accountWasmHash: "a".repeat(64) });
  });
  it("lists current and historical defaults, keeping an explicit environment selection", async () => {
    const { knownPools } = await import("@/lib/stellar");
    expect(knownPools()).toEqual([CURRENT, LEGACY]);
    vi.stubEnv("POOL_ID", SAVED);
    expect(knownPools()).toEqual([SAVED, CURRENT, LEGACY]);
  });
});

describe("saved pool discovery", () => {
  function saved(value: string) {
    const getItem = vi.fn().mockReturnValue(value);
    vi.stubGlobal("window", { localStorage: { getItem } });
    return getItem;
  }
  it("keeps old browser pools alongside the new default, without duplicates", () => {
    const read = saved(JSON.stringify([SAVED, LEGACY, CURRENT]));
    expect(loadPools(CURRENT, [CURRENT, LEGACY])).toEqual([CURRENT, LEGACY, SAVED]);
    expect(read).toHaveBeenCalledWith(POOLS_KEY);
  });
  it("handles malformed JSON without losing the historical default", () => {
    saved("broken");
    expect(loadPools(CURRENT, [LEGACY])).toEqual([CURRENT, LEGACY]);
  });
  it("ignores non-array or invalid saved entries", () => {
    saved("{}");
    expect(loadPools(CURRENT)).toEqual([CURRENT]);
    saved(JSON.stringify([null, 7, "bad", SAVED]));
    expect(loadPools(CURRENT)).toEqual([CURRENT, SAVED]);
  });
  it("works without browser storage", () => {
    vi.stubGlobal("window", undefined);
    expect(loadPools(CURRENT, [LEGACY])).toEqual([CURRENT, LEGACY]);
  });
});
