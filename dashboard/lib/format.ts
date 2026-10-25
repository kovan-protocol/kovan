// USDC has 7 decimals. All contract amounts are base units as bigint.
export const USDC_DECIMALS = 7;
const UNIT = 10n ** BigInt(USDC_DECIMALS);
/** Average testnet ledger close time used for hour → ledger conversion. */
export const LEDGER_SECONDS = 5;

/** `5000000n` → `"0.50 USDC"`. Trims to at most 2 decimals unless more are needed. */
export function usdc(units: bigint | string | number): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / UNIT;
  const frac = (abs % UNIT).toString().padStart(USDC_DECIMALS, "0");
  let fracTrimmed = frac.replace(/0+$/, "");
  if (fracTrimmed.length < 2) fracTrimmed = fracTrimmed.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}.${fracTrimmed} USDC`;
}

/** `"0.5"` → `5000000n`. Throws on malformed or over-precise input. */
export function unitsFromUsdc(s: string): bigint {
  const m = /^\s*(\d+)(?:\.(\d{0,7}))?\s*$/.exec(s);
  if (!m) throw new Error(`invalid USDC amount: ${JSON.stringify(s)}`);
  const [, whole, frac = ""] = m;
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(USDC_DECIMALS, "0"));
}

/** Ledger sequence `hours` from now, given the latest ledger. */
export function ledgerFromHours(latest: number, hours: number): number {
  if (!(hours > 0)) throw new Error("hours must be positive");
  return latest + Math.ceil((hours * 3600) / LEDGER_SECONDS);
}

export function shortId(id: string, n = 6): string {
  return id.length <= 2 * n + 1 ? id : `${id.slice(0, n)}…${id.slice(-4)}`;
}
