// Server-side: send a signed transaction and wait for its result.
import { rpc, TransactionBuilder, xdr, scValToNative } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, rpcServer } from "./stellar";
import { explainError } from "./errors";

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
  if (sent.status === "ERROR") {
    const raw = sent.errorResult ? sent.errorResult.toXDR("base64") : "sendTransaction error";
    const diag = (sent.diagnosticEvents ?? []).map((d: xdr.DiagnosticEvent) => diagToString(d)).join(" | ");
    return { hash: sent.hash, status: "ERROR", error: explainError(diag || raw), raw: diag || raw };
  }
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const r = await server.getTransaction(sent.hash);
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
      const raw = r.resultXdr?.toXDR("base64") ?? "failed";
      const diag = (r.diagnosticEventsXdr ?? []).map((d) => diagToString(d)).join(" | ");
      return { hash: sent.hash, status: "FAILED", error: explainError(diag || raw), raw: diag || raw };
    }
  }
  return { hash: sent.hash, status: "NOT_FOUND", error: "timed out waiting for confirmation" };
}

function diagToString(d: xdr.DiagnosticEvent): string {
  try {
    const body = d.event().body().v0();
    const topics = body.topics().map((t) => safeNative(t));
    return `${JSON.stringify(topics)}=${JSON.stringify(safeNative(body.data()))}`;
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
