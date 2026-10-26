import { submitSigned as sdkSubmit, type ErrorContext, type SubmitResult } from "@kovan/sdk";
import { NETWORK_PASSPHRASE, rpcServer, ids } from "./stellar";
export type { SubmitResult } from "@kovan/sdk";

export async function submitSigned(signedXdr: string): Promise<SubmitResult> {
  let context: ErrorContext = {};
  try { const id = ids(); context = { pool: id.pool, usdc: id.usdc }; } catch { /* Diagnostic names are optional. */ }
  return sdkSubmit({ rpc: rpcServer(), networkPassphrase: NETWORK_PASSPHRASE }, signedXdr, { context });
}
