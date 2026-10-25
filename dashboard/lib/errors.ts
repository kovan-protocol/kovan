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

export type DecodedError = { code: number; name: string; source: "pool" | "covenant" | "smart-account" | "unknown" };

/** Finds the first `Error(Contract, #N)` in a host error message and names it. */
export function decodeContractError(msg: string): DecodedError | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(msg);
  if (!m) return null;
  const code = Number(m[1]);
  if (code in COVENANT_ERRORS) return { code, name: COVENANT_ERRORS[code], source: "covenant" };
  if (code in SMART_ACCOUNT_ERRORS) return { code, name: SMART_ACCOUNT_ERRORS[code], source: "smart-account" };
  if (code in POOL_ERRORS) return { code, name: POOL_ERRORS[code], source: "pool" };
  return { code, name: `Unknown#${code}`, source: "unknown" };
}

/** Human line for the log: decoded contract error, auth error, or the raw message trimmed. */
export function explainError(msg: string): string {
  const d = decodeContractError(msg);
  if (d) return `#${d.code} ${d.name}`;
  if (/Error\(Auth/.test(msg)) return "Error(Auth) — the signer is not allowed to do this";
  return msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
}
