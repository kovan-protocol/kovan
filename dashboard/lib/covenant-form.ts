// Pure: form strings → contract arguments. No network, no React.
import { StrKey } from "@stellar/stellar-sdk";
import type { CovenantParams } from "./contracts";
import { ledgerFromHours, unitsFromUsdc } from "./format";

export type CallRuleForm = { contract: string; fnName: string; amountArg: string; amountCap: string };

export type CovenantForm = {
  agentKey: string; // G… or 64 hex chars
  drawLimit: string; // USDC
  providers: string; // one address per line
  providerPerTransfer: string;
  providerTotal: string;
  recipients: string;
  recipientPerTransfer: string;
  recipientTotal: string;
  expiryHours: string;
  calls: CallRuleForm[];
};

export type CovenantArgs = { agent_pubkey: string; draw_limit: bigint; covenant: Omit<CovenantParams, "pool" | "usdc"> };

export const EMPTY_FORM: CovenantForm = {
  agentKey: "",
  drawLimit: "0.5",
  providers: "",
  providerPerTransfer: "0.2",
  providerTotal: "0.5",
  recipients: "",
  recipientPerTransfer: "",
  recipientTotal: "",
  expiryHours: "24",
  calls: [],
};

function pubkeyHex(input: string): string {
  const s = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  if (StrKey.isValidEd25519PublicKey(s)) return Buffer.from(StrKey.decodeEd25519PublicKey(s)).toString("hex");
  throw new Error("Agent key must be a G… address or 64 hex characters");
}

function addressList(text: string, label: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((a) => {
      if (StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a)) return a;
      throw new Error(`${label} "${a}" is not a Stellar address`);
    });
}

function amountOrZero(s: string, label: string): bigint {
  if (!s.trim()) return 0n;
  try {
    return unitsFromUsdc(s);
  } catch {
    throw new Error(`${label} must be a USDC amount like 0.50`);
  }
}

export function buildCovenantArgs(f: CovenantForm, latestLedger: number): CovenantArgs {
  const agent_pubkey = pubkeyHex(f.agentKey);
  const draw_limit = amountOrZero(f.drawLimit, "Draw limit");
  if (draw_limit <= 0n) throw new Error("Draw limit must be positive");
  const providers = addressList(f.providers, "Provider");
  const recipients = addressList(f.recipients, "Recipient");
  const hours = Number(f.expiryHours);
  if (!(hours > 0)) throw new Error("Expiry must be a positive number of hours");
  const calls = f.calls
    .filter((c) => c.contract.trim() || c.fnName.trim())
    .map((c) => {
      if (!StrKey.isValidContract(c.contract.trim())) throw new Error(`Call contract "${c.contract}" is not a C… address`);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(c.fnName.trim())) throw new Error(`Call function "${c.fnName}" is not a valid name`);
      const amount_arg = c.amountArg.trim() === "" ? undefined : Number(c.amountArg);
      if (amount_arg !== undefined && !(Number.isInteger(amount_arg) && amount_arg >= 0)) throw new Error("Amount arg index must be a whole number");
      return { contract: c.contract.trim(), fn_name: c.fnName.trim(), amount_arg, amount_cap: amountOrZero(c.amountCap, "Call cap") };
    });
  return {
    agent_pubkey,
    draw_limit,
    covenant: {
      providers,
      provider_per_transfer_cap: providers.length ? amountOrZero(f.providerPerTransfer, "Provider per-transfer cap") : 0n,
      provider_total_cap: providers.length ? amountOrZero(f.providerTotal, "Provider total cap") : 0n,
      recipients,
      recipient_per_transfer_cap: recipients.length ? amountOrZero(f.recipientPerTransfer, "Recipient per-transfer cap") : 0n,
      recipient_total_cap: recipients.length ? amountOrZero(f.recipientTotal, "Recipient total cap") : 0n,
      calls,
      expiry: ledgerFromHours(latestLedger, hours),
    },
  };
}
