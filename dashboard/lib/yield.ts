// Server-side DeFindex verification and bounded quotes. No API key, signer, or broadcasts.
import { createHash } from "node:crypto";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";
import { reviewedYieldVaults, type VaultAsset, type VaultAllocation } from "@kovan-protocol/sdk/experimental";
import { deployments } from "./deployments";
import { readPool, readYield, simulateRead } from "./contracts";
import { rpcServer, withRetry } from "./stellar";
import type { OwnerArgs } from "./owner";

export type YieldAction = "invest" | "lock_shares" | "redeem_shares";
export type YieldQuote = { [F in YieldAction]: { fn: F; args: OwnerArgs[F]; pool: string; vault: string; expected: string; minimum: string; unit: "shares" | "USDC"; validUntil: number } }[YieldAction];
export function configuredVaults(usdc: string) {
  return reviewedYieldVaults(deployments(), usdc);
}

export async function verifyVault(vault: string, usdc: string, expectedHash: string) {
  const actualHash = createHash("sha256").update(await withRetry(() => rpcServer().getContractWasmByContractId(vault))).digest("hex");
  if (actualHash !== expectedHash.toLowerCase()) throw new Error("Vault code changed. New investments are blocked; review the integration.");
  const [assets, decimals] = await Promise.all([
    simulateRead<VaultAsset[]>(vault, "get_assets"), simulateRead<number>(vault, "decimals"),
  ]);
  if (assets.length !== 1 || assets[0].address !== usdc || decimals !== 7) throw new Error("Vault must use exactly this pool’s USDC contract and 7-decimal transferable shares.");
  return assets[0];
}

export async function requireListedVault(vault: string, usdc: string, hash?: string) {
  const entry = configuredVaults(usdc).find((v) => v.vault === vault && (!hash || hash === v.wasm_hash));
  if (!entry) throw new Error("No reviewed matching vault is enabled for this pool. Yield activation is unavailable.");
  const asset = await verifyVault(vault, usdc, entry.wasm_hash);
  if (entry.strategies) {
    if (new Set(entry.strategies.map(s => s.address)).size !== entry.strategies.length || asset.strategies.length !== entry.strategies.length
      || asset.strategies.some(s => !entry.strategies!.some(p => p.address === s.address))) throw new Error("Vault strategy set changed. Review the integration.");
    for (const strategy of entry.strategies) {
      const actual = createHash("sha256").update(await withRetry(() => rpcServer().getContractWasmByContractId(strategy.address))).digest("hex");
      if (actual !== strategy.wasm_hash.toLowerCase()) throw new Error("Strategy code changed. New investments are blocked.");
      if (await simulateRead<string>(strategy.address, "asset") !== usdc) throw new Error("Strategy must accept this pool's exact USDC contract.");
    }
  }
  return entry;
}

/** invest=true follows existing ratios: reject an entirely idle/paused vault. */
export async function requireActiveAllocation(vault: string, usdc: string) {
  const [assets, funds] = await Promise.all([
    simulateRead<VaultAsset[]>(vault, "get_assets"), simulateRead<VaultAllocation[]>(vault, "fetch_total_managed_funds"),
  ]);
  if (assets.length !== 1 || assets[0].address !== usdc || funds.length !== 1 || funds[0].asset !== usdc
    || funds[0].invested_amount <= 0n || !funds[0].strategy_allocations.some(a => a.amount > 0n && !a.paused && assets[0].strategies.some(s => s.address === a.strategy_address && !s.paused))) {
    throw new Error("Vault has no active investment allocation. Its manager must seed and activate a strategy before investing pool USDC.");
  }
}

export function positiveUnits(amount: unknown): bigint {
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) throw new Error("Enter a positive base-unit amount");
  const n = BigInt(amount);
  if (n <= 0n || n > (1n << 127n) - 1n) throw new Error("Amount is outside the positive i128 range");
  return n;
}
export function minimumOutput(expected: bigint): bigint {
  const minimum = expected * 9950n / 10_000n; // 0.5% slippage, rounded conservatively
  if (minimum <= 0n) throw new Error("Amount is too small for a protected quote");
  return minimum;
}

export async function quoteYield(pool: string, action: YieldAction, rawAmount: string): Promise<YieldQuote> {
  if (!["invest", "lock_shares", "redeem_shares"].includes(action)) throw new Error("Unknown yield action");
  const amount = positiveUnits(rawAmount);
  const p = await readPool(pool);
  if ((p.accounting_version ?? 1) < 3) throw new Error("Yield requires a newly deployed v3 pool; this pool is cash-only.");
  const y = await readYield(pool);
  if (!y.vault) throw new Error("Configure a reviewed vault first");
  if (!y.valuation_ok) throw new Error("Vault valuation unavailable or code changed. Recovery remains available.");
  if (action !== "redeem_shares") {
    if (p.closed) throw new Error("This pool is permanently closed");
    await requireListedVault(y.vault, p.usdc);
  }
  const latest = await withRetry(() => rpcServer().getLatestLedger());
  const validUntil = latest.sequence + 60;
  const val = (n: bigint) => nativeToScVal(n, { type: "i128" });
  let expected: bigint;
  if (action === "invest") {
    if (amount > (p.balance ?? 0n)) throw new Error("Amount exceeds liquid USDC in this pool");
    await requireActiveAllocation(y.vault, p.usdc);
    const supply = await simulateRead<bigint>(y.vault, "total_supply");
    if (supply <= 1000n) throw new Error("Only initialized, seeded vaults are supported; first-deposit bootstrapping requires separate review.");
    const assets = await simulateRead<bigint[]>(y.vault, "get_asset_amounts_per_shares", [val(supply)]);
    if (assets.length !== 1 || assets[0] <= 0n) throw new Error("Invalid vault valuation");
    expected = amount * supply / assets[0];
    return { fn: action, args: { amount: amount.toString(), min_shares: minimumOutput(expected).toString(), valid_until: validUntil }, pool, vault: y.vault, expected: expected.toString(), minimum: minimumOutput(expected).toString(), unit: "shares", validUntil };
  }
  if (action === "lock_shares") {
    const balance = await simulateRead<bigint>(y.vault, "balance", [new Address(p.owner).toScVal()]);
    if (amount > balance) throw new Error("Amount exceeds vault shares held by the pool owner");
  }
  if (action === "redeem_shares" && amount > y.shares) throw new Error("Amount exceeds the pool’s share balance");
  const assets = await simulateRead<bigint[]>(y.vault, "get_asset_amounts_per_shares", [val(amount)]);
  if (assets.length !== 1 || assets[0] < 0n) throw new Error("Invalid vault valuation");
  expected = assets[0];
  return { fn: action, args: { shares: amount.toString(), min_assets: minimumOutput(expected).toString(), valid_until: validUntil }, pool, vault: y.vault, expected: expected.toString(), minimum: minimumOutput(expected).toString(), unit: "USDC", validUntil };
}
