/** Single-asset DeFindex provisioning. Native yield uses the same vault ABI as
 * imported positions; yield comes from the selected strategy, never a fixed APY.
 * ABI: defindex-io/stellar-contracts @ 529f7c5006387e8c59c8d68014ff87761b8a3490.
 */
import { Buffer } from "buffer";
import { Address, Contract, hash, Networks, scValToNative, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { addrVal, bytes32Val, positiveAmount, structVal, u32Val } from "./scval.js";
import { assertNetwork, prepareOperation, simulateRead, type Transport } from "./transport.js";

export type YieldStrategy = { address: string; wasm_hash: string };
export type YieldVault = {
  name: string; vault: string; wasm_hash: string; usdc: string;
  /** Omitted on older manifests = external. Native means a Kovan-managed vault. */
  kind?: "native" | "external";
  /** Pin every strategy, in addition to the vault executable. */
  strategies?: YieldStrategy[];
};
type YieldManifest = { network: string; yield_vaults?: YieldVault[]; current_release?: { yield_vaults?: YieldVault[] } };

/** A release's explicit empty list disables activation; never resurrect old entries. */
export function reviewedYieldVaults(manifest: YieldManifest, usdc: string): YieldVault[] {
  if (manifest.network !== "testnet") return [];
  const entries = (manifest.current_release?.yield_vaults ?? manifest.yield_vaults ?? []).filter(v => v.usdc === usdc);
  const unique = new Map<string, YieldVault>();
  for (const entry of entries) {
    contractAddress(entry.vault); contractAddress(entry.usdc); bytes32Val(entry.wasm_hash);
    if (!entry.name.trim() || (entry.kind && !["native", "external"].includes(entry.kind))) throw new Error("Invalid yield vault metadata");
    if (entry.kind === "native" && entry.strategies?.length !== 1) throw new Error("Native yield requires one reviewed strategy");
    for (const strategy of entry.strategies ?? []) { contractAddress(strategy.address); bytes32Val(strategy.wasm_hash); }
    const previous = unique.get(entry.vault);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error("Conflicting yield vault entries");
    unique.set(entry.vault, entry);
  }
  return [...unique.values()];
}

export type VaultAsset = { address: string; strategies: { address: string; name: string; paused: boolean }[] };
export type VaultAllocation = {
  asset: string; total_amount: bigint; idle_amount: bigint; invested_amount: bigint;
  strategy_allocations: { strategy_address: string; amount: bigint; paused: boolean }[];
};
function contractAddress(value: string) {
  if (!value.startsWith("C")) throw new Error("Expected a contract address");
  return new Address(value);
}
async function checkCode(ctx: Transport, address: string, expected: string) {
  contractAddress(address); bytes32Val(expected);
  if (hash(Buffer.from(await ctx.rpc.getContractWasmByContractId(address))).toString("hex") !== expected.toLowerCase()) throw new Error("Yield contract code changed; review before depositing");
}
async function checkStrategy(ctx: Transport, strategy: YieldStrategy, usdc: string) {
  await checkCode(ctx, strategy.address, strategy.wasm_hash);
  if (await simulateRead<string>(ctx, strategy.address, "asset") !== usdc) throw new Error("Strategy does not accept Kovan's exact USDC contract");
}
export async function verifyYieldVault(ctx: Transport, vault: YieldVault): Promise<VaultAsset> {
  await assertNetwork(ctx);
  await checkCode(ctx, vault.vault, vault.wasm_hash);
  const [assets, decimals] = await Promise.all([
    simulateRead<VaultAsset[]>(ctx, vault.vault, "get_assets"), simulateRead<number>(ctx, vault.vault, "decimals"),
  ]);
  if (assets.length !== 1 || assets[0].address !== vault.usdc || decimals !== 7) throw new Error("Vault must use the exact USDC contract and 7-decimal shares");
  if (vault.kind === "native" && vault.strategies?.length !== 1) throw new Error("Native yield requires one reviewed strategy");
  if (vault.strategies) {
    if (new Set(vault.strategies.map(s => s.address)).size !== vault.strategies.length || assets[0].strategies.length !== vault.strategies.length
      || assets[0].strategies.some(s => !vault.strategies!.some(p => p.address === s.address))) throw new Error("Vault strategy set changed; review before depositing");
    await Promise.all(vault.strategies.map(s => checkStrategy(ctx, s, vault.usdc)));
  }
  return assets[0];
}

/** Allocation is observable; an APY cannot be inferred from a single snapshot. */
export async function inspectYieldVault(ctx: Transport, vault: YieldVault) {
  const asset = await verifyYieldVault(ctx, vault);
  const [supply, allocations] = await Promise.all([
    simulateRead<bigint>(ctx, vault.vault, "total_supply"),
    simulateRead<VaultAllocation[]>(ctx, vault.vault, "fetch_total_managed_funds"),
  ]);
  if (allocations.length !== 1 || allocations[0].asset !== vault.usdc) throw new Error("Invalid vault allocation");
  const funds = allocations[0];
  if (funds.idle_amount < 0n || funds.invested_amount < 0n || funds.total_amount !== funds.idle_amount + funds.invested_amount) throw new Error("Invalid vault accounting");
  const hasActiveAllocation = supply > 1000n && funds.invested_amount > 0n && funds.strategy_allocations.some(a => a.amount > 0n && !a.paused && asset.strategies.some(s => s.address === a.strategy_address && !s.paused));
  return { supply, ...funds, hasActiveAllocation };
}

export type NativeYieldSource = {
  factory: string; factory_wasm_hash: string; vault_wasm_hash: string;
  usdc: string; strategy: YieldStrategy; router: string;
  /** Reject factory fee changes above the reviewed ceiling (share of vault fees). */
  max_protocol_fee_bps: number;
};

/** Recover only an actual, successful creation through the pinned factory.
 * A simulation preview or a caller-supplied vault address is never a receipt.
 * Comparing the full constructor call also proves zero fees, all manager roles,
 * the strategy, router, metadata and immutable deployment were selected. */
export async function nativeVaultFromReceipt(ctx: Transport, source: NativeYieldSource, manager: string, creationHash: string): Promise<YieldVault> {
  if (ctx.networkPassphrase !== Networks.TESTNET) throw new Error("Native yield provisioning is testnet-only");
  if (!/^[a-f0-9]{64}$/i.test(creationHash)) throw new Error("Invalid vault creation transaction hash");
  await assertNetwork(ctx);
  const receipt = await ctx.rpc.getTransaction(creationHash);
  if (receipt.status !== "SUCCESS") throw new Error(`Vault creation is ${receipt.status}; reconcile this transaction before creating another vault`);
  const tx = TransactionBuilder.fromXDR(receipt.envelopeXdr, Networks.TESTNET);
  if (!("source" in tx) || tx.source !== manager || tx.operations.length !== 1) throw new Error("Vault creation must be a single transaction from the connected manager");
  const operation = tx.operations[0];
  if (operation.type !== "invokeHostFunction" || (operation.source && operation.source !== manager)
    || operation.func.switch().name !== "hostFunctionTypeInvokeContract") throw new Error("Unexpected vault creation operation");
  const call = operation.func.invokeContract();
  const amounts = call.args().length === 8 ? scValToNative(call.args()[7]) : undefined;
  if (!Array.isArray(amounts) || amounts.length !== 1 || typeof amounts[0] !== "bigint") throw new Error("Invalid vault seed in creation receipt");
  const expected = buildCreateNativeVaultOp(source, manager, amounts[0].toString()).body().invokeHostFunctionOp().hostFunction().invokeContract();
  if (call.toXDR("base64") !== expected.toXDR("base64")) throw new Error("Creation receipt does not match the reviewed native vault configuration");
  if (!receipt.returnValue) throw new Error("Missing committed vault address");
  const address = scValToNative(receipt.returnValue);
  if (typeof address !== "string") throw new Error("Invalid committed vault address");
  contractAddress(address);
  await checkCode(ctx, source.factory, source.factory_wasm_hash);
  const vault: YieldVault = { name: "Kovan USDC Yield", kind: "native", vault: address, wasm_hash: source.vault_wasm_hash, usdc: source.usdc, strategies: [source.strategy] };
  await verifyYieldVault(ctx, vault);
  const [roles, fees] = await Promise.all([
    Promise.all(["get_manager", "get_emergency_manager", "get_rebalance_manager", "get_fee_receiver"].map(fn => simulateRead<string>(ctx, address, fn))),
    simulateRead<number[]>(ctx, address, "get_fees"),
  ]);
  if (roles.some(role => role !== manager)) throw new Error("Native vault roles no longer belong to its original manager");
  if (fees.length !== 2 || fees[0] !== 0 || fees[1] > source.max_protocol_fee_bps) throw new Error("Native vault fees changed; review before activation");
  return vault;
}
const vector = (...values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
const string = (value: string) => xdr.ScVal.scvString(value);

/** Creation and seeding are atomic, so nobody can front-run the initial deposit.
 * All four roles belong to the named manager. Immutable vault; zero Kovan fee. */
export function buildCreateNativeVaultOp(source: NativeYieldSource, manager: string, seedAmount: string): xdr.Operation {
  const seed = positiveAmount(seedAmount);
  if (BigInt(seedAmount) <= 1000n) throw new Error("Seed must exceed the vault's 1000 base-unit minimum liquidity lock");
  [source.factory, source.usdc, source.strategy.address, source.router].forEach(contractAddress);
  const roles = xdr.ScVal.scvMap([0, 1, 2, 3].map(role => new xdr.ScMapEntry({ key: u32Val(role), val: addrVal(manager) })));
  const asset = structVal({ address: addrVal(source.usdc), strategies: vector(structVal({ address: addrVal(source.strategy.address), name: string("Kovan lending"), paused: xdr.ScVal.scvBool(false) })) });
  const metadata = xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: string("name"), val: string("Kovan USDC Yield") }), new xdr.ScMapEntry({ key: string("symbol"), val: string("kvUSDC") })]);
  return new Contract(source.factory).call("create_defindex_vault_deposit", addrVal(manager), roles, u32Val(0), vector(asset), addrVal(source.router), metadata, xdr.ScVal.scvBool(false), vector(seed));
}

/** These helpers prepare unsigned testnet transactions. They never sign or broadcast. */
export async function prepareNativeVault(ctx: Transport, source: NativeYieldSource, manager: string, seedAmount: string) {
  const operation = buildCreateNativeVaultOp(source, manager, seedAmount);
  if (ctx.networkPassphrase !== Networks.TESTNET) throw new Error("Native yield provisioning is testnet-only");
  await assertNetwork(ctx);
  bytes32Val(source.vault_wasm_hash);
  if (!Number.isInteger(source.max_protocol_fee_bps) || source.max_protocol_fee_bps < 0 || source.max_protocol_fee_bps > 9000) throw new Error("Invalid maximum protocol fee");
  await checkCode(ctx, source.factory, source.factory_wasm_hash);
  await checkStrategy(ctx, source.strategy, source.usdc);
  const [vaultHash, fee] = await Promise.all([
    simulateRead<Uint8Array>(ctx, source.factory, "vault_wasm_hash"), simulateRead<number>(ctx, source.factory, "defindex_fee"),
  ]);
  if (Buffer.from(vaultHash).toString("hex") !== source.vault_wasm_hash.toLowerCase()) throw new Error("Factory vault code changed");
  if (!Number.isInteger(fee) || fee < 0 || fee > source.max_protocol_fee_bps) throw new Error("Factory protocol fee exceeds the reviewed ceiling");
  return prepareOperation(ctx, { source: manager, operation });
}

async function nativeManager(ctx: Transport, vault: YieldVault, manager: string) {
  if (ctx.networkPassphrase !== Networks.TESTNET || vault.kind !== "native") throw new Error("Expected a native testnet vault");
  const asset = await verifyYieldVault(ctx, vault);
  if (asset.strategies.some(s => s.paused)) throw new Error("Native yield strategy is paused");
  if (await simulateRead<string>(ctx, vault.vault, "get_manager") !== manager) throw new Error("Connect the native vault manager");
}

/** First seed stays idle until rebalance establishes a strategy allocation.
 * Later Kovan deposits with invest=true follow that allocation automatically. */
export async function prepareActivateNativeVault(ctx: Transport, vault: YieldVault, manager: string, amount: string) {
  const value = positiveAmount(amount);
  await nativeManager(ctx, vault, manager);
  const state = await inspectYieldVault(ctx, vault);
  if (state.supply <= 1000n || BigInt(amount) > state.idle_amount) throw new Error("Activation needs seeded, available vault cash");
  return prepareOperation(ctx, { source: manager, operation: new Contract(vault.vault).call("rebalance", addrVal(manager), vector(vector(xdr.ScVal.scvSymbol("Invest"), addrVal(vault.strategies![0].address), value))) });
}
