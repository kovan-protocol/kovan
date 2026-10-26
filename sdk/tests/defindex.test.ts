import { describe, expect, it } from "vitest";
import { Account, Address, hash, nativeToScVal, Networks, scValToNative, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";
import { buildCreateNativeVaultOp, inspectYieldVault, nativeVaultFromReceipt, prepareActivateNativeVault, prepareNativeVault, reviewedYieldVaults, verifyYieldVault, type NativeYieldSource, type YieldVault } from "../src/experimental.js";
import { addrVal, bytes32Val, i128Val, structVal, u32Val } from "../src/index.js";
import { AGENT, code, entry, owner, POOL, POLICY, TOKEN, VERIFIER, setup, simulation } from "./fixtures.js";

const digest = hash(code).toString("hex");
const vault: YieldVault = { name: "Kovan USDC Yield", kind: "native", vault: POOL, usdc: TOKEN, wasm_hash: digest, strategies: [{ address: POLICY, wasm_hash: digest }] };
const source: NativeYieldSource = { factory: VERIFIER, factory_wasm_hash: digest, vault_wasm_hash: digest, usdc: TOKEN, strategy: vault.strategies![0], router: AGENT, max_protocol_fee_bps: 2000 };
const vec = (...values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
function fixture() {
  const { rpc } = setup();
  const reads: Record<string, xdr.ScVal> = {
    asset: addrVal(TOKEN), decimals: u32Val(7), get_manager: addrVal(owner.publicKey()), total_supply: i128Val(100_000n),
    get_emergency_manager: addrVal(owner.publicKey()), get_rebalance_manager: addrVal(owner.publicKey()), get_fee_receiver: addrVal(owner.publicKey()), get_fees: vec(u32Val(0), u32Val(2000)),
    vault_wasm_hash: bytes32Val(digest), defindex_fee: u32Val(2000),
    get_assets: vec(structVal({ address: addrVal(TOKEN), strategies: vec(structVal({ address: addrVal(POLICY), name: xdr.ScVal.scvString("lending"), paused: xdr.ScVal.scvBool(false) })) })),
    fetch_total_managed_funds: vec(structVal({ asset: addrVal(TOKEN), total_amount: i128Val(100_000n), idle_amount: i128Val(40_000n), invested_amount: i128Val(60_000n), strategy_allocations: vec(structVal({ strategy_address: addrVal(POLICY), amount: i128Val(60_000n), paused: xdr.ScVal.scvBool(false) })) })),
  };
  rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => {
    const fn = (tx.operations[0] as { func: xdr.HostFunction }).func.invokeContract().functionName().toString();
    return simulation(reads[fn] ?? addrVal(POOL));
  });
  return { rpc, reads, ctx: { rpc, networkPassphrase: Networks.TESTNET } };
}

describe("native DeFindex vault provisioning", () => {
  it("atomically creates and seeds a single-USDC immutable vault owned by the manager", () => {
    const call = buildCreateNativeVaultOp(source, owner.publicKey(), "10000000").body().invokeHostFunctionOp().hostFunction().invokeContract();
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(source.factory);
    expect(call.functionName().toString()).toBe("create_defindex_vault_deposit");
    const [caller, roles, fee, assets, router, metadata, upgradable, amounts] = call.args().map(scValToNative);
    expect(caller).toBe(owner.publicKey());
    expect(Object.values(roles)).toEqual(Array(4).fill(owner.publicKey()));
    expect(fee).toBe(0);
    expect(assets).toEqual([{ address: TOKEN, strategies: [{ address: POLICY, name: "Kovan lending", paused: false }] }]);
    expect(router).toBe(AGENT); expect(metadata.symbol).toBe("kvUSDC"); expect(upgradable).toBe(false); expect(amounts).toEqual([10000000n]);
  });
  it("checks factory/strategy/asset/fees and prepares unsigned XDR without sending", async () => {
    const { ctx, rpc } = fixture();
    const tx = await prepareNativeVault(ctx, source, owner.publicKey(), "10000000");
    expect(TransactionBuilder.fromXDR(tx.xdr, Networks.TESTNET).signatures).toHaveLength(0);
    expect(rpc.getContractWasmByContractId.mock.calls).toEqual([[source.factory], [source.strategy.address]]);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it("rejects a wrong USDC strategy before preparing any funded transaction", async () => {
    const { ctx, reads, rpc } = fixture(); reads.asset = addrVal(AGENT);
    await expect(prepareNativeVault(ctx, source, owner.publicKey(), "10000000")).rejects.toThrow("exact USDC");
    expect(rpc.getAccount).not.toHaveBeenCalled();
  });
  it.each(["factory", "vault", "fee"])("rejects changed %s configuration", async changed => {
    const { ctx, reads, rpc } = fixture();
    if (changed === "factory") rpc.getContractWasmByContractId.mockResolvedValue(Buffer.from("replacement"));
    if (changed === "vault") reads.vault_wasm_hash = bytes32Val("1".repeat(64));
    if (changed === "fee") reads.defindex_fee = u32Val(2001);
    await expect(prepareNativeVault(ctx, source, owner.publicKey(), "10000000")).rejects.toThrow(/changed|ceiling/);
    expect(rpc.getAccount).not.toHaveBeenCalled();
  });
  it("rejects dust seeds, wrong networks and extra authorizers", async () => {
    const { ctx, rpc } = fixture();
    expect(() => buildCreateNativeVaultOp(source, owner.publicKey(), "1000")).toThrow("minimum liquidity");
    await expect(prepareNativeVault({ ...ctx, networkPassphrase: Networks.PUBLIC }, source, owner.publicKey(), "2000")).rejects.toThrow("testnet-only");
    const impl = rpc.simulateTransaction.getMockImplementation()!;
    rpc.simulateTransaction.mockImplementation(async (tx: Transaction) => (tx.operations[0] as { func: xdr.HostFunction }).func.invokeContract().functionName().toString() === "create_defindex_vault_deposit" ? simulation(addrVal(POOL), [entry()]) : impl(tx));
    await expect(prepareNativeVault(ctx, source, owner.publicKey(), "2000")).rejects.toThrow("signature");
  });
  it("activates only the pinned strategy with a bounded Invest instruction", async () => {
    const { ctx, rpc } = fixture();
    const tx = await prepareActivateNativeVault(ctx, vault, owner.publicKey(), "40000");
    const parsed = TransactionBuilder.fromXDR(tx.xdr, Networks.TESTNET) as Transaction;
    const call = (parsed.operations[0] as { func: xdr.HostFunction }).func.invokeContract();
    expect(call.functionName().toString()).toBe("rebalance");
    expect(call.args().map(scValToNative)).toEqual([owner.publicKey(), [["Invest", POLICY, 40000n]]]);
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
    await expect(prepareActivateNativeVault(ctx, vault, owner.publicKey(), "40001")).rejects.toThrow("available vault cash");
  });
  it("checks native manager and seeded supply before activation", async () => {
    const { ctx, reads } = fixture();
    reads.get_manager = addrVal(TOKEN);
    await expect(prepareActivateNativeVault(ctx, vault, owner.publicKey(), "10")).rejects.toThrow("manager");
    reads.get_manager = addrVal(owner.publicKey()); reads.total_supply = i128Val(0n);
    await expect(prepareActivateNativeVault(ctx, vault, owner.publicKey(), "10")).rejects.toThrow("seeded");
  });
});

describe("native vault creation receipts", () => {
  function receiptFixture() {
    const f = fixture();
    const envelope = (op = buildCreateNativeVaultOp(source, owner.publicKey(), "10000000")) => new TransactionBuilder(new Account(owner.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET }).addOperation(op).setTimeout(60).build().toEnvelope();
    f.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", envelopeXdr: envelope(), returnValue: addrVal(POOL) } as never);
    return { ...f, envelope };
  }
  it("recovers the committed address and verifies current roles, fees, code and strategy", async () => {
    const { ctx, rpc } = receiptFixture();
    expect(await nativeVaultFromReceipt(ctx, source, owner.publicKey(), "a".repeat(64))).toMatchObject({ vault: POOL, kind: "native", usdc: TOKEN });
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["NOT_FOUND", "FAILED"])("does not treat %s as a deployed vault", async status => {
    const { ctx, rpc } = receiptFixture(); rpc.getTransaction.mockResolvedValue({ status } as never);
    await expect(nativeVaultFromReceipt(ctx, source, owner.publicKey(), "a".repeat(64))).rejects.toThrow("reconcile");
    expect(rpc.getContractWasmByContractId).not.toHaveBeenCalled();
  });
  it("rejects a receipt for another source configuration", async () => {
    const { ctx, rpc, envelope } = receiptFixture();
    rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", envelopeXdr: envelope(buildCreateNativeVaultOp({ ...source, strategy: { ...source.strategy, address: AGENT } }, owner.publicKey(), "10000000")), returnValue: addrVal(POOL) } as never);
    await expect(nativeVaultFromReceipt(ctx, source, owner.publicKey(), "a".repeat(64))).rejects.toThrow("does not match");
  });
  it("refuses changed roles or vault fees", async () => {
    const { ctx, reads } = receiptFixture(); reads.get_rebalance_manager = addrVal(AGENT);
    await expect(nativeVaultFromReceipt(ctx, source, owner.publicKey(), "a".repeat(64))).rejects.toThrow("roles");
    reads.get_rebalance_manager = addrVal(owner.publicKey()); reads.get_fees = vec(u32Val(100), u32Val(2000));
    await expect(nativeVaultFromReceipt(ctx, source, owner.publicKey(), "a".repeat(64))).rejects.toThrow("fees");
  });
});

describe("vault compatibility and readiness", () => {
  it("reads current-release integrations without resurrecting delisted entries", () => {
    const manifest = { network: "testnet", yield_vaults: [vault], current_release: { yield_vaults: [] } };
    expect(reviewedYieldVaults(manifest, TOKEN)).toEqual([]);
    expect(reviewedYieldVaults({ ...manifest, current_release: { yield_vaults: [vault] } }, TOKEN)).toEqual([vault]);
    expect(reviewedYieldVaults({ network: "testnet", yield_vaults: [vault] }, AGENT)).toEqual([]);
    expect(reviewedYieldVaults({ network: "mainnet", yield_vaults: [vault] }, TOKEN)).toEqual([]);
    expect(() => reviewedYieldVaults({ network: "testnet", yield_vaults: [vault, { ...vault, wasm_hash: "1".repeat(64) }] }, TOKEN)).toThrow("Conflicting");
  });
  it("requires a pinned native strategy and rejects replacement strategy code", async () => {
    const { ctx, rpc } = fixture();
    await expect(verifyYieldVault(ctx, { ...vault, strategies: undefined })).rejects.toThrow("one reviewed strategy");
    rpc.getContractWasmByContractId.mockImplementation(async (id: string) => id === POLICY ? Buffer.from("changed strategy") : code);
    await expect(verifyYieldVault(ctx, vault)).rejects.toThrow("code changed");
  });
  it("rejects an unexpected strategy set", async () => {
    const { ctx } = fixture();
    await expect(verifyYieldVault(ctx, { ...vault, strategies: [{ address: AGENT, wasm_hash: digest }] })).rejects.toThrow("strategy set changed");
  });
  it("distinguishes an active allocation from a vault holding only idle cash", async () => {
    const { ctx, reads } = fixture();
    expect(await inspectYieldVault(ctx, vault)).toMatchObject({ hasActiveAllocation: true, invested_amount: 60_000n });
    reads.fetch_total_managed_funds = nativeToScVal([{ asset: new Address(TOKEN), total_amount: 100_000n, idle_amount: 100_000n, invested_amount: 0n, strategy_allocations: [] }]);
    expect(await inspectYieldVault(ctx, vault)).toMatchObject({ hasActiveAllocation: false, invested_amount: 0n });
  });
});
