// Browser-side Freighter wrapper and the owner-action round trip.
"use client";

import { getNetwork, requestAccess, signMessage, signTransaction } from "@stellar/freighter-api";
import { Buffer } from "buffer";
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

async function keyRequest<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/agent/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error ?? "Could not complete the signer key request");
  return result as T;
}

/** A one-use message authorization; never submitted as a chain transaction. */
async function authorizeKey(action: "generate" | "export", owner: string, pool: string, agent?: string) {
  const challenge = await keyRequest<{ id: string; message: string }>({ action: `${action}-challenge`, owner, pool, agent });
  const signed = await signMessage(challenge.message, { address: owner, networkPassphrase: TESTNET_PASSPHRASE });
  if (signed.error || !signed.signedMessage) throw new Error(signed.error?.message ?? "Key authorization was cancelled");
  if (signed.signerAddress !== owner) throw new Error("Sign with the pool owner's wallet");
  const signature = typeof signed.signedMessage === "string" ? signed.signedMessage : Buffer.from(signed.signedMessage).toString("base64");
  return { challengeId: challenge.id, signature };
}

export async function generateAgentKey(owner: string, pool: string): Promise<{ publicKey: string }> {
  const proof = await authorizeKey("generate", owner, pool);
  return keyRequest({ action: "generate", ...proof, label: `agent-${Date.now()}` });
}

/** The secret exists only in this response and the explicitly requested download. */
export async function downloadAgentKey(owner: string, pool: string, agent: string): Promise<void> {
  const proof = await authorizeKey("export", owner, pool, agent);
  const result = await keyRequest<{ publicKey: string; secret: string; agent: string; pool: string; network: string }>({ action: "export", ...proof });
  const blob = new Blob([JSON.stringify({ ...result, kind: "kovan-agent-signer", version: 1 }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kovan-agent-${agent.slice(0, 8)}-signer.json`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** build (server) → sign (Freighter) → submit (server). */
export async function runOwnerAction<F extends OwnerFn>(fn: F | "create_pool", args: OwnerArgs[F] | Record<string, never>, source: string, pool?: string | null): Promise<OwnerResult> {
  const b = await fetch("/api/tx/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn, args, source, pool: pool ?? undefined }) });
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
