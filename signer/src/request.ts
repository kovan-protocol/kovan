// A signing request, as carried in the link: `#r=<base64url(JSON)>`.
//
// The link says *what* to do. The connected wallet says *who* does it, so an
// agent can make a link without knowing the owner's address. Nothing in the
// link can choose contract code, the covenant policy, the verifier or the
// asset: those come from the deployment record built into the page.
import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import type { MandateInput } from "@kovan-protocol/sdk";

export const USDC_DECIMALS = 7;
const UNIT = 10n ** BigInt(USDC_DECIMALS);
export const LEDGER_SECONDS = 5;
export const MAX_EXPIRY_HOURS = 720;
const MAX_LIST = 10;

export type SignRequest =
  | { fn: "create_pool" }
  | { fn: "trustline" }
  | { fn: "fund" | "withdraw"; pool: string; amount: bigint }
  | {
      fn: "create_agent";
      pool: string;
      agentKey: string; // G… form, for display
      agentPubkeyHex: string;
      drawLimit: bigint;
      providers: string[];
      providerPerTransferCap: bigint;
      providerTotalCap: bigint;
      recipients: string[];
      recipientPerTransferCap: bigint;
      recipientTotalCap: bigint;
      expiryHours: number;
    }
  | { fn: "revoke" | "close"; pool: string; agent: string }
  | { fn: "create_mandate"; pool: string; agent: string; mandate: MandateInput }
  | { fn: "revoke_mandate"; pool: string; agent: string; mandateId: string }
  | { fn: "return_funds"; pool: string; agent: string; amount: bigint };

export type Fn = SignRequest["fn"];

/** Fields each function accepts, besides `v` and `fn`. Anything else is refused. */
const FIELDS: Record<Fn, readonly string[]> = {
  create_pool: [],
  trustline: [],
  fund: ["pool", "amount"],
  withdraw: ["pool", "amount"],
  create_agent: [
    "pool", "agent_key", "draw_limit", "expiry_hours",
    "providers", "provider_per_transfer_cap", "provider_total_cap",
    "recipients", "recipient_per_transfer_cap", "recipient_total_cap",
  ],
  revoke: ["pool", "agent"],
  close: ["pool", "agent"],
  return_funds: ["pool", "agent", "amount"],
  create_mandate: ["pool", "agent", "mandate_id", "intent_hash", "expiry_ledger", "scope", "payee", "amount", "reference", "payees", "per_payment_cap", "total_cap"],
  revoke_mandate: ["pool", "agent", "mandate_id"],
};

export class RequestError extends Error {}
const fail = (msg: string): never => { throw new RequestError(msg); };

/** A request plus where to deliver the result. `id` is echoed back so the agent can match it. */
export type Envelope = { req: SignRequest; callback?: string; id?: string };

/** Reads `#r=…` from a location hash. Returns null when the page was opened without a request. */
export function parseHash(hash: string): Envelope | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const r = params.get("r");
  if (!r) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(r.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return fail("The link is damaged: its request is not valid base64url JSON.");
  }
  return parseEnvelope(json);
}

export function parseEnvelope(input: unknown): Envelope {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("The request must be a JSON object.");
  const { callback, id, ...rest } = input as Record<string, unknown>;
  const env: Envelope = { req: parseRequest(rest) };
  if (callback !== undefined) env.callback = callbackUrl(callback);
  if (id !== undefined) {
    if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) fail("\"id\" must be 1-64 letters, digits, dots, dashes or underscores.");
    env.id = id as string;
  }
  return env;
}

/** https anywhere, or plain http only to this machine (an agent listening locally). */
export function callbackUrl(v: unknown): string {
  let u: URL | null = null;
  try { u = typeof v === "string" ? new URL(v) : null; } catch { /* reported below */ }
  if (!u) return fail("\"callback\" must be a URL.");
  const local = u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) fail("\"callback\" must be https://… or http://127.0.0.1:<port>/… on this machine.");
  if (u.username || u.password) fail("\"callback\" must not contain credentials.");
  return u.toString();
}

/** Encodes a request object into the `#r=` fragment. Used by tests and documented for agents. */
export function encodeRequest(obj: Record<string, unknown>): string {
  return "#r=" + Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

export function parseRequest(input: unknown): SignRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail("The request must be a JSON object.");
  const o = input as Record<string, unknown>;
  if (o.v !== 1) fail("Unsupported request version; expected \"v\": 1.");
  const fn = o.fn as Fn;
  if (typeof fn !== "string" || !Object.hasOwn(FIELDS, fn)) fail(`Unknown action ${JSON.stringify(o.fn)}.`);
  const allowed = new Set(["v", "fn", ...FIELDS[fn]]);
  const extra = Object.keys(o).filter((k) => !allowed.has(k));
  if (extra.length) fail(`This page does not accept ${extra.map((k) => `"${k}"`).join(", ")} for ${fn}.`);

  switch (fn) {
    case "create_pool": case "trustline":
      return { fn };
    case "fund": case "withdraw":
      return { fn, pool: contract(o.pool, "pool"), amount: usdc(o.amount, "amount", true) };
    case "revoke": case "close":
      return { fn, pool: contract(o.pool, "pool"), agent: contract(o.agent, "agent") };
    case "return_funds":
      return { fn, pool: contract(o.pool, "pool"), agent: contract(o.agent, "agent"), amount: usdc(o.amount, "amount", true) };
    case "create_agent":
      return createAgent(o);
    case "create_mandate":
      return createMandate(o);
    case "revoke_mandate":
      return { fn, pool: contract(o.pool, "pool"), agent: contract(o.agent, "agent"), mandateId: commitment(o.mandate_id, "mandate_id") };
  }
}

export function commitment(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value) || /^0{64}$/.test(value)) return fail(`"${name}" must be a nonzero 32-byte hex value.`);
  return value.toLowerCase();
}
function createMandate(o: Record<string, unknown>): SignRequest {
  if (!Number.isSafeInteger(o.expiry_ledger) || Number(o.expiry_ledger) <= 0 || Number(o.expiry_ledger) > 0xffffffff) fail("expiry_ledger must be a positive u32 ledger number");
  const mandate: MandateInput = { id: commitment(o.mandate_id, "mandate_id"), intent_hash: commitment(o.intent_hash, "intent_hash"), expiry: Number(o.expiry_ledger), scope: undefined as never };
  if (o.scope === "exact") {
    if ([o.payees, o.per_payment_cap, o.total_cap].some(v => v !== undefined)) fail("Exact mandates do not accept budget fields");
    // The placeholder never crosses the wire: prepare() substitutes the trusted asset.
    mandate.scope = { kind: "exact", asset: "", payee: payees([o.payee], "payee")[0], amount: usdc(o.amount, "amount", true).toString(), reference: commitment(o.reference, "reference") };
  } else if (o.scope === "budget") {
    if ([o.payee, o.amount, o.reference].some(v => v !== undefined)) fail("Budget mandates do not accept exact-payment fields");
    const allowed = payees(o.payees, "payees");
    const per = usdc(o.per_payment_cap, "per_payment_cap", true), total = usdc(o.total_cap, "total_cap", true);
    caps("mandate", allowed, per, total);
    if (!allowed.length) fail("A budget mandate needs payees");
    mandate.scope = { kind: "budget", payees: allowed, per_payment_cap: per.toString(), total_cap: total.toString() };
  } else fail("scope must be exact or budget");
  return { fn: "create_mandate", pool: contract(o.pool, "pool"), agent: contract(o.agent, "agent"), mandate };
}

function createAgent(o: Record<string, unknown>): SignRequest {
  const { key, hex } = agentKey(o.agent_key);
  const providers = payees(o.providers, "providers");
  const recipients = payees(o.recipients, "recipients");
  const both = providers.filter((p) => recipients.includes(p));
  if (both.length) fail(`${both[0]} is on both lists; put each payee on one list only.`);
  const req = {
    fn: "create_agent" as const,
    pool: contract(o.pool, "pool"),
    agentKey: key,
    agentPubkeyHex: hex,
    drawLimit: usdc(o.draw_limit, "draw_limit", true),
    providers,
    providerPerTransferCap: usdc(o.provider_per_transfer_cap ?? "0", "provider_per_transfer_cap", false),
    providerTotalCap: usdc(o.provider_total_cap ?? "0", "provider_total_cap", false),
    recipients,
    recipientPerTransferCap: usdc(o.recipient_per_transfer_cap ?? "0", "recipient_per_transfer_cap", false),
    recipientTotalCap: usdc(o.recipient_total_cap ?? "0", "recipient_total_cap", false),
    expiryHours: hours(o.expiry_hours),
  };
  caps("provider", providers, req.providerPerTransferCap, req.providerTotalCap);
  caps("recipient", recipients, req.recipientPerTransferCap, req.recipientTotalCap);
  if (!providers.length && !recipients.length) fail("The agent needs at least one provider or recipient it may pay.");
  return req;
}

function caps(list: string, payees: string[], per: bigint, total: bigint) {
  if (!payees.length) {
    if (per !== 0n || total !== 0n) fail(`${list} caps are set but the ${list}s list is empty.`);
    return;
  }
  if (per <= 0n || total <= 0n) fail(`Set ${list}_per_transfer_cap and ${list}_total_cap above 0.`);
  if (per > total) fail(`${list}_per_transfer_cap is above ${list}_total_cap.`);
}

function contract(v: unknown, name: string): string {
  if (typeof v !== "string" || !StrKey.isValidContract(v)) fail(`"${name}" must be a contract address (C…).`);
  return v as string;
}

function payees(v: unknown, name: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail(`"${name}" must be a list of addresses.`);
  const list = v as unknown[];
  if (list.length > MAX_LIST) fail(`"${name}" can hold at most ${MAX_LIST} addresses.`);
  const out: string[] = [];
  for (const a of list) {
    if (typeof a !== "string" || !(StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a))) {
      fail(`Every entry in "${name}" must be a G… or C… address (muxed M… addresses are refused).`);
    }
    if (out.includes(a as string)) fail(`${a} appears twice in "${name}".`);
    out.push(a as string);
  }
  return out;
}

function agentKey(v: unknown): { key: string; hex: string } {
  if (typeof v === "string" && StrKey.isValidEd25519PublicKey(v)) {
    return { key: v, hex: Buffer.from(StrKey.decodeEd25519PublicKey(v)).toString("hex") };
  }
  if (typeof v === "string" && /^[0-9a-fA-F]{64}$/.test(v)) {
    const hex = v.toLowerCase();
    return { key: StrKey.encodeEd25519PublicKey(Buffer.from(hex, "hex")), hex };
  }
  if (typeof v === "string" && /^S[A-Z2-7]{55}$/.test(v)) {
    fail("\"agent_key\" looks like a SECRET key. Never put a secret in a link. Use the agent's public key (G…).");
  }
  return fail("\"agent_key\" must be the agent's public key: G… or 64 hex characters.");
}

/** USDC as a decimal string or number with at most 7 decimals. Never floating-point arithmetic. */
export function usdc(v: unknown, name: string, positive: boolean): bigint {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  const m = typeof s === "string" ? /^(\d+)(?:\.(\d{1,7}))?$/.exec(s.trim()) : null;
  if (!m) return fail(`"${name}" must be a USDC amount like "100" or "0.25" (at most 7 decimals).`);
  const units = BigInt(m[1]) * UNIT + BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0"));
  if (positive && units <= 0n) fail(`"${name}" must be above 0.`);
  return units;
}

function hours(v: unknown): number {
  const h = v === undefined ? 24 : v;
  if (typeof h !== "number" || !Number.isFinite(h) || h <= 0 || h > MAX_EXPIRY_HOURS) {
    fail(`"expiry_hours" must be a number of hours between 0 and ${MAX_EXPIRY_HOURS}.`);
  }
  return h as number;
}

export function ledgerFromHours(latest: number, h: number): number {
  return latest + Math.ceil((h * 3600) / LEDGER_SECONDS);
}

export function formatUsdc(units: bigint): string {
  const whole = units / UNIT;
  const frac = (units % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac.padEnd(2, "0") : ".00"} USDC`;
}

export type Summary = { title: string; rows: [string, string][]; notes: string[] };

/** What the owner is about to sign, in plain words. Built only from the parsed request. */
export function describe(req: SignRequest): Summary {
  switch (req.fn) {
    case "create_pool":
      return {
        title: "Create a new Kovan pool",
        rows: [["Owner", "Your connected wallet (permanent: a pool's owner cannot be changed)"], ["Pool code", "Kovan's published testnet pool"]],
        notes: ["The pool starts empty. Funding it is a separate request."],
      };
    case "trustline":
      return {
        title: "Let your wallet hold testnet USDC",
        rows: [["Asset", "USDC (Circle testnet issuer)"]],
        notes: ["Adds a USDC trustline to your connected wallet. It moves no money."],
      };
    case "fund":
      return { title: `Lock ${formatUsdc(req.amount)} in a pool`, rows: [["Pool", req.pool], ["Amount", formatUsdc(req.amount)], ["From", "Your connected wallet"]], notes: [] };
    case "withdraw":
      return { title: `Withdraw ${formatUsdc(req.amount)} from a pool`, rows: [["Pool", req.pool], ["Amount", formatUsdc(req.amount)], ["To", "Your connected wallet"]], notes: ["Only funds no agent's draw limit is backing can be withdrawn."] };
    case "revoke":
      return { title: "Revoke an agent", rows: [["Pool", req.pool], ["Agent", req.agent]], notes: ["Stops the agent's payments and calls, and those of its child agents. Returning funds to the pool keeps working."] };
    case "close":
      return { title: "Close an agent", rows: [["Pool", req.pool], ["Agent", req.agent]], notes: ["Final. Recovers what is left in the agent's wallet, settles what it spent and releases its unused draw limit. Legacy v1 pools need drawn funds returned first."] };
    case "return_funds":
      return { title: `Pull ${formatUsdc(req.amount)} back into the pool`, rows: [["Pool", req.pool], ["From agent", req.agent], ["Amount", formatUsdc(req.amount)]], notes: ["Uses the allowance the agent's wallet gave the pool at creation; no agent signature is needed."] };
    case "revoke_mandate":
      return { title: "Permanently revoke a payment mandate", rows: [["Pool", req.pool], ["Agent", req.agent], ["Mandate ID", req.mandateId]], notes: ["Future payments using this grant are refused. Settled transfers cannot be undone."] };
    case "create_mandate": {
      const m = req.mandate, s = m.scope;
      const rows: [string, string][] = [["Pool", req.pool], ["Agent", req.agent], ["Mandate ID", m.id], ["Intent commitment", m.intent_hash], ["Expiry ledger (exclusive)", String(m.expiry)], ["Asset", "Configured testnet USDC"]];
      if (s.kind === "exact") rows.push(["Payee", s.payee], ["Exact amount", formatUsdc(BigInt(s.amount))], ["Purchase reference", s.reference]);
      else rows.push(["Payees", s.payees.join("\n")], ["Per-payment cap", formatUsdc(BigInt(s.per_payment_cap))], ["Total budget", formatUsdc(BigInt(s.total_cap))]);
      return { title: s.kind === "exact" ? "Approve one exact payment" : "Approve an autonomous spending budget", rows,
        notes: [s.kind === "exact" ? "Usable once, even with a different payment ID." : "The agent chooses individual purchases within this budget. Different IDs can authorize different purchases.", "Existing covenant limits still apply. This does not fund the agent or verify delivery.", "Keep the original intent document and this mandate ID. The chain records only its hash."] };
    }
    case "create_agent": {
      const rows: [string, string][] = [
        ["Pool", req.pool],
        ["Agent key", req.agentKey],
        ["Draw limit", formatUsdc(req.drawLimit)],
        ["Expires", `in ${req.expiryHours} hours`],
      ];
      if (req.providers.length) {
        rows.push(["May pay providers", req.providers.join("\n")]);
        rows.push(["Provider caps", `${formatUsdc(req.providerPerTransferCap)} per payment, ${formatUsdc(req.providerTotalCap)} in total`]);
      }
      if (req.recipients.length) {
        rows.push(["May pay recipients", req.recipients.join("\n")]);
        rows.push(["Recipient caps", `${formatUsdc(req.recipientPerTransferCap)} per payment, ${formatUsdc(req.recipientTotalCap)} in total`]);
      }
      return {
        title: `Create an agent with a ${formatUsdc(req.drawLimit)} draw limit`,
        rows,
        notes: [
          "Check every payee: the agent can pay these addresses and no others. Lists cannot be changed later.",
          "The agent key is public. Whoever holds its secret can spend inside these rules.",
          "New mandate-capable agents also need a separate owner-approved payment mandate before spending.",
        ],
      };
    }
  }
}
