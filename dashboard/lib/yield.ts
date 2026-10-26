// Server-side DeFindex verification and bounded quotes. No API key, signer, or broadcasts.
import { createHash } from "node:crypto";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { deployments } from "./deployments";
import { readPool, readYield, simulateRead } from "./contracts";
import { rpcServer, withRetry } from "./stellar";
import type { OwnerArgs } from "./owner";

export type YieldAction = "invest" | "lock_shares" | "redeem_shares";
export type YieldQuote = { [F in YieldAction]: { fn: F; args: OwnerArgs[F]; pool: string; vault: string; expected: string; minimum: string; unit: "shares" | "USDC"; validUntil: number } }[YieldAction];
export function configuredVaults(usdc: string) {
  const d = deployments();
  if (d.network !== "testnet") return [];
  return (d.yield_vaults ?? []).filter((v) => v.usdc === usdc);
}

export async function verifyVault(vault: string, usdc: string, expectedHash: string) {
  const actualHash = createHash("sha256").update(await withRetry(() => rpcServer().getContractWasmByContractId(vault))).digest("hex");
  if (actualHash !== expectedHash) throw new Error("Vault code changed. New investments are blocked; review the integration.");
  const [assets, decimals] = await Promise.all([
    simulateRead<{ address: string }[]>(vault, "get_assets"), simulateRead<number>(vault, "decimals"),
  ]);
  if (assets.length !== 1 || assets[0].address !== usdc || decimals !== 7) throw new Error("Vault must use exactly this pool’s USDC contract and 7-decimal transferable shares.");
}

export async function requireListedVault(vault: string, usdc: string, hash?: string) {
  const entry = configuredVaults(usdc).find((v) => v.vault === vault && (!hash || hash === v.wasm_hash));
  if (!entry) throw new Error("No reviewed matching vault is enabled for this pool. Yield activation is unavailable.");
  await verifyVault(vault, usdc, entry.wasm_hash);
  return entry;
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
    const supply = await simulateRead<bigint>(y.vault, "total_supply");
    if (supply <= 1000n) throw new Error("Only initialized, seeded vaults are supported; first-deposit bootstrapping requires separate review.");
    const assets = await simulateRead<bigint[]>(y.vault, "get_asset_amounts_per_shares", [val(supply)]);
    if (assets.length !== 1 || assets[0] <= 0n) throw new Error("Invalid vault valuation");
    expected = amount * supply / assets[0];
    return { fn: action, args: { amount: amount.toString(), min_shares: minimumOutput(expected).toString(), valid_until: validUntil }, pool, vault: y.vault, expected: expected.toString(), minimum: minimumOutput(expected).toString(), unit: "shares", validUntil };
  }
  if (action === "redeem_shares" && amount > y.shares) throw new Error("Amount exceeds the pool’s share balance");
  const assets = await simulateRead<bigint[]>(y.vault, "get_asset_amounts_per_shares", [val(amount)]);
  if (assets.length !== 1 || assets[0] < 0n) throw new Error("Invalid vault valuation");
  expected = assets[0];
  return { fn: action, args: { shares: amount.toString(), min_assets: minimumOutput(expected).toString(), valid_until: validUntil }, pool, vault: y.vault, expected: expected.toString(), minimum: minimumOutput(expected).toString(), unit: "USDC", validUntil };
}
