// Browser-side Freighter wrapper and the owner-action round trip.
"use client";

import { getNetwork, requestAccess, signTransaction } from "@stellar/freighter-api";
import type { OwnerArgs, OwnerFn } from "./owner";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export async function connectFreighter(): Promise<string> {
  const r = await requestAccess();
  if (r.error) throw new Error(typeof r.error === "string" ? r.error : (r.error as { message?: string }).message ?? "Freighter refused access");
  const net = await getNetwork();
  if (net.networkPassphrase && net.networkPassphrase !== TESTNET_PASSPHRASE) {
    throw new Error(`Freighter is on ${net.network ?? "another network"}; switch it to Testnet`);
  }
  return r.address;
}

export type OwnerResult = { hash?: string; status: string; error?: string; raw?: string; returnValue?: unknown };

/** build (server) → sign (Freighter) → submit (server). */
export async function runOwnerAction<F extends OwnerFn>(fn: F, args: OwnerArgs[F], source: string): Promise<OwnerResult> {
  const b = await fetch("/api/tx/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn, args, source }) });
  const bj = await b.json();
  if (!b.ok) return { status: "REJECTED", error: bj.error ?? "build failed", raw: bj.raw };
  const signed = await signTransaction(bj.xdr, { networkPassphrase: TESTNET_PASSPHRASE, address: source });
  if (signed.error) {
    const e = signed.error as unknown;
    return { status: "REJECTED", error: typeof e === "string" ? e : ((e as { message?: string }).message ?? "signing cancelled") };
  }
  const s = await fetch("/api/tx/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedXdr: signed.signedTxXdr }) });
  return (await s.json()) as OwnerResult;
}
