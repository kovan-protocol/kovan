// Send once, then poll. Unknown confirmation is not a failure and must not be rebuilt blindly.
import { Buffer } from "buffer";
import { StrKey, TransactionBuilder, xdr, scValToNative } from "@stellar/stellar-sdk";
import { assertNetwork, type Transport } from "./transport.js";
import { explainError, scErrorToText, type ErrorContext } from "./errors.js";

export type SubmitResult = {
  hash: string;
  status: "SUCCESS" | "FAILED" | "NOT_FOUND" | "ERROR";
  error?: string;
  raw?: string;
  returnValue?: unknown;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reconcile a persisted hash without constructing, signing or sending anything. */
export async function transactionStatus(t: Transport, hash: string): Promise<SubmitResult> {
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Invalid transaction hash");
  await assertNetwork(t);
  const r = await t.rpc.getTransaction(hash);
  if (r.status === "SUCCESS") return { hash, status: "SUCCESS", returnValue: r.returnValue ? scValToNative(r.returnValue) : undefined };
  if (r.status === "FAILED") return { hash, status: "FAILED", error: r.resultXdr ? txResultCode(r.resultXdr) : "Transaction failed" };
  return { hash, status: "NOT_FOUND" };
}

export async function submitSigned(t: Transport, signedXdr: string, opts: { context?: ErrorContext; attempts?: number; intervalMs?: number } = {}): Promise<SubmitResult> {
  const attempts = opts.attempts ?? 30;
  const intervalMs = opts.intervalMs ?? 1500;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120 || !Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 10000) throw new Error("Invalid confirmation polling options");
  await assertNetwork(t);
  const server = t.rpc;
  const tx = TransactionBuilder.fromXDR(signedXdr, t.networkPassphrase);
  const ctx = opts.context ?? {};
  let sent: Awaited<ReturnType<typeof server.sendTransaction>>;
  try { sent = await server.sendTransaction(tx); }
  catch {
    return { hash: tx.hash().toString("hex"), status: "NOT_FOUND", error: "Submission outcome unknown; query this hash before retrying. Do not rebuild blindly." };
  }
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    const code = sent.errorResult ? txResultCode(sent.errorResult) : sent.status;
    const diag = (sent.diagnosticEvents ?? []).map((d: xdr.DiagnosticEvent) => diagToString(d)).filter(Boolean).join(" | ");
    const raw = [code, diag].filter(Boolean).join(" ");
    return { hash: sent.hash, status: "ERROR", error: explainError(raw, ctx), raw };
  }
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    let r: Awaited<ReturnType<typeof server.getTransaction>>;
    try { r = await server.getTransaction(sent.hash); } catch { continue; }
    if (r.status === "SUCCESS") {
      let returnValue: unknown;
      try {
        returnValue = r.returnValue ? scValToNative(r.returnValue) : undefined;
      } catch {
        returnValue = undefined;
      }
      return { hash: sent.hash, status: "SUCCESS", returnValue };
    }
    if (r.status === "FAILED") {
      const code = r.resultXdr ? txResultCode(r.resultXdr) : "failed";
      const diag = (r.diagnosticEventsXdr ?? []).map((d) => diagToString(d)).filter(Boolean).join(" | ");
      const raw = [code, diag].filter(Boolean).join(" ");
      return { hash: sent.hash, status: "FAILED", error: explainError(raw, ctx), raw };
    }
  }
  return { hash: sent.hash, status: "NOT_FOUND", error: "Confirmation unknown; query this transaction hash before retrying" };
}

/** `txBadAuth`, `txFailed`, … from a TransactionResult. */
function txResultCode(res: xdr.TransactionResult): string {
  try {
    return res.result().switch().name;
  } catch {
    return "";
  }
}

/** Renders a diagnostic event; error events become `Error(Contract, #N)` text so explainError can read them. */
function diagToString(d: xdr.DiagnosticEvent): string {
  try {
    const ev = d.event();
    const body = ev.body().v0();
    const topics = body.topics().map((t) => safeNative(t));
    const data = safeNative(body.data());
    const errTopic = topics.find((t) => t && typeof t === "object" && "code" in (t as object));
    const err = scErrorToText((errTopic ?? (data && typeof data === "object" && "code" in (data as object) ? data : null)) as never);
    const who = ev.contractId() ? ` contract:${contractIdToStrkey(ev.contractId()!)}` : "";
    return `${err || JSON.stringify(topics)}${who}=${JSON.stringify(data)}`;
  } catch {
    return "";
  }
}

function contractIdToStrkey(id: xdr.ContractId): string {
  try {
    return StrKey.encodeContract(Buffer.from(id as unknown as Uint8Array));
  } catch {
    return "";
  }
}

function safeNative(v: xdr.ScVal): unknown {
  try {
    const n = scValToNative(v);
    return typeof n === "bigint" ? n.toString() : n;
  } catch {
    return v.switch().name;
  }
}
