// Contract error codes → names. Mirrors contracts/pool/src/storage.rs (PoolError),
// contracts/covenant-types/src/lib.rs (CovenantError, 39XX) and OpenZeppelin
// stellar-accounts 0.8.0 SmartAccountError (30XX).

export const POOL_ERRORS: Record<number, string> = {
  1: "NotOwner",
  2: "NotAgent",
  3: "NotOwnerOrParent",
  4: "ExceedsLocked",
  5: "ExceedsDrawLimit",
  6: "NotActive",
  7: "DrawnNotZero",
  8: "ExceedsRemaining",
  9: "BelowDrawn",
  10: "Insufficient",
  11: "NotActiveOrSettle",
  12: "ChildExceedsParent",
  13: "AmountNotPositive",
  14: "UnknownAgent",
  15: "TooManyChildren",
};

export const COVENANT_ERRORS: Record<number, string> = {
  3900: "NotInstalled",
  3901: "AlreadyInstalled",
  3902: "NotAllowed",
  3903: "WrongAsset",
  3904: "PayeeNotAllowed",
  3905: "AmountNotPositive",
  3906: "PerTransferCapExceeded",
  3907: "TotalCapExceeded",
  3908: "Expired",
  3909: "Revoked",
  3910: "CallNotAllowed",
  3911: "CallCapExceeded",
  3912: "SelfCallForbidden",
  3913: "NoSigner",
  3914: "NotPool",
};

export const SMART_ACCOUNT_ERRORS: Record<number, string> = {
  3000: "ContextRuleNotFound",
  3002: "UnvalidatedContext",
  3003: "ExternalVerificationFailed",
  3004: "NoSignersAndPolicies",
  3005: "PastValidUntil",
  3006: "SignerNotFound",
  3007: "DuplicateSigner",
  3008: "PolicyNotFound",
  3009: "DuplicatePolicy",
  3010: "TooManySigners",
  3011: "TooManyPolicies",
  3012: "MathOverflow",
  3013: "KeyDataTooLarge",
  3014: "ContextRuleIdsLengthMismatch",
  3015: "NameTooLong",
  3016: "UnauthorizedSigner",
  3017: "DelegatedSignerIsContextContract",
  3018: "SelfDelegatedSigner",
};

/** Stellar Asset Contract error codes (soroban-env ContractError). */
export const SAC_ERRORS: Record<number, string> = {
  1: "InternalError",
  2: "OperationNotSupported",
  3: "AlreadyInitialized",
  4: "Unauthorized",
  5: "AuthenticationError",
  6: "AccountMissing",
  7: "AccountIsNotClassic",
  8: "NegativeAmount",
  9: "AllowanceError",
  10: "BalanceError",
  11: "BalanceDeauthorized",
  12: "OverflowError",
  13: "TrustlineMissing",
};

export type DecodedError = { code: number; name: string; source: "pool" | "covenant" | "smart-account" | "usdc" | "unknown" };
export type ErrorContext = { usdc?: string; pool?: string };

/**
 * Finds the first `Error(Contract, #N)` in a host error message and names it.
 * Low codes collide between the pool and the USDC SAC; when the message names
 * the raising contract (`contract:C…`), that decides.
 */
export function decodeContractError(msg: string, ctx: ErrorContext = {}): DecodedError | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(msg);
  if (!m) return null;
  const code = Number(m[1]);
  if (code in COVENANT_ERRORS) return { code, name: COVENANT_ERRORS[code], source: "covenant" };
  if (code in SMART_ACCOUNT_ERRORS) return { code, name: SMART_ACCOUNT_ERRORS[code], source: "smart-account" };
  const raisedBy = /contract:\s*(C[A-Z2-7]{55})/.exec(msg)?.[1];
  if (raisedBy && ctx.usdc && raisedBy === ctx.usdc && code in SAC_ERRORS) return { code, name: SAC_ERRORS[code], source: "usdc" };
  if (code in POOL_ERRORS) return { code, name: POOL_ERRORS[code], source: "pool" };
  if (code in SAC_ERRORS) return { code, name: SAC_ERRORS[code], source: "usdc" };
  return { code, name: `Unknown#${code}`, source: "unknown" };
}

/** Renders a decoded ScError value (from a diagnostic event) the way the host prints it. */
export function scErrorToText(v: { type?: string; code?: number | string; value?: string } | null | undefined): string {
  if (!v || typeof v !== "object" || v.code === undefined) return "";
  if (v.type === "contract") return `Error(Contract, #${v.code})`;
  const name = typeof v.value === "string" ? v.value.replace(/^scec/, "") : String(v.code);
  // system errors about authorization are what a wrong signer produces
  if (/InvalidAction|Auth/i.test(name)) return `Error(Auth, ${name})`;
  return `Error(${v.type ?? "System"}, ${name})`;
}

const TX_RESULT_HINTS: Record<string, string> = {
  txBadAuth: "transaction is missing a required signature",
  txBadAuthExtra: "transaction has an unexpected signature",
  txBadSeq: "sequence number is stale; retry",
  txInsufficientFee: "fee too low",
  txInsufficientBalance: "fee payer cannot cover the fee",
  txFailed: "operation failed",
};

/** Human line for the log: decoded contract error, auth error, tx result hint, or the raw message trimmed. */
export function explainError(msg: string, ctx: ErrorContext = {}): string {
  const d = decodeContractError(msg, ctx);
  if (d) return `#${d.code} ${d.name}`;
  if (/Error\(Auth/.test(msg)) return "Error(Auth) — the signer is not allowed to do this";
  for (const [code, hint] of Object.entries(TX_RESULT_HINTS)) if (msg.includes(code)) return `${code}: ${hint}`;
  return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
}
