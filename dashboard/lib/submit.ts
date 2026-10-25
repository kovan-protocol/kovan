// Server-side: send a signed transaction and wait for its result.
import { StrKey, TransactionBuilder, xdr, scValToNative } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, rpcServer, withRetry, ids } from "./stellar";
import { explainError, scErrorToText, type ErrorContext } from "./errors";

export type SubmitResult = {
  hash: string;
  status: "SUCCESS" | "FAILED" | "NOT_FOUND" | "ERROR";
  error?: string;
  raw?: string;
  returnValue?: unknown;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function submitSigned(signedXdr: string): Promise<SubmitResult> {
  const server = rpcServer();
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sent = await server.sendTransaction(tx);
  const ctx: ErrorContext = (() => {
    try {
      const i = ids();
      return { usdc: i.usdc, pool: i.pool };
    } catch {
      return {};
    }
  })();
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    const code = sent.errorResult ? txResultCode(sent.errorResult) : sent.status;
    const diag = (sent.diagnosticEvents ?? []).map((d: xdr.DiagnosticEvent) => diagToString(d)).filter(Boolean).join(" | ");
    const raw = [code, diag].filter(Boolean).join(" ");
    return { hash: sent.hash, status: "ERROR", error: explainError(raw, ctx), raw };
  }
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const r = await withRetry(() => server.getTransaction(sent.hash));
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
  return { hash: sent.hash, status: "NOT_FOUND", error: "timed out waiting for confirmation" };
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
