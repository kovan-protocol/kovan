"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signTransaction } from "@stellar/freighter-api";
import { signPrepared } from "@kovan-protocol/sdk";
import type { YieldVault } from "@kovan-protocol/sdk/experimental";
import { ConsoleHeader } from "@/components/ConsoleHeader";
import { WalletButton } from "@/components/WalletButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unitsFromUsdc, usdc } from "@/lib/format";
import { TESTNET_PASSPHRASE, type OwnerResult } from "@/lib/wallet";

type Action = "create" | "activate";
type Progress = { manager: string; creationHash?: string; activationHash?: string; pending?: { action: Action; hash: string } };
type Inspection = { vault: YieldVault; enabled: boolean; state: { total_amount: string; idle_amount: string; invested_amount: string; hasActiveAllocation: boolean } };
const storageKey = "kovan-xoxno-setup-v1";

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/yield/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Vault setup request failed");
  return result as T;
}

export default function YieldSetupPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [amount, setAmount] = useState("1");
  const [receipt, setReceipt] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const connected = !!address && (!progress || progress.manager === address);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) setProgress(JSON.parse(saved) as Progress);
      } catch { setError("Saved setup could not be loaded. Resume using your creation transaction hash."); }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function save(next: Progress) {
    // Persist before submission. If storage fails, no signed transaction is sent.
    localStorage.setItem(storageKey, JSON.stringify(next));
    setProgress(next);
  }
  async function inspect(next: Progress) {
    const result = await request<Inspection>({ action: "inspect", manager: next.manager, creationHash: next.creationHash });
    setInspection(result);
    setAmount(usdc(result.state.idle_amount).replace(/ USDC$/, "").replaceAll(",", ""));
  }
  async function work(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setMessage(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function reconcile(next: Progress, result: OwnerResult) {
    const pending = next.pending;
    if (!pending) return;
    if (result.status === "SUCCESS") {
      const confirmed = { ...next, pending: undefined, ...(pending.action === "create" ? { creationHash: pending.hash } : { activationHash: pending.hash }) };
      save(confirmed);
      setAccepted(false);
      await inspect(confirmed);
      setMessage(pending.action === "create" ? "Vault created and seeded. Activate its lending allocation next." : "Investment confirmed. The live allocation is shown below.");
    } else if (result.status === "FAILED") {
      save({ ...next, pending: undefined });
      throw new Error(result.error ?? "The transaction failed on-chain. No vault changes were committed.");
    } else {
      throw new Error("Confirmation is unresolved. Check this transaction before trying another creation or investment.");
    }
  }
  async function transact(action: Action) {
    if (!address || !connected || progress?.pending || !accepted) return;
    await work(async () => {
      const manager = address;
      const units = unitsFromUsdc(amount);
      if (units <= 0n) throw new Error("Enter a positive USDC amount");
      const prepared = await request<{ xdr: string; hash: string }>({ action, manager, amount: units.toString(), creationHash: progress?.creationHash });
      const signedXdr = await signPrepared({ ...prepared, source: manager, networkPassphrase: TESTNET_PASSPHRASE, preview: undefined }, async xdr => {
        const signed = await signTransaction(xdr, { address: manager, networkPassphrase: TESTNET_PASSPHRASE });
        if (signed.error || !signed.signedTxXdr) throw new Error(signed.error?.message ?? "Wallet signing was cancelled");
        return signed.signedTxXdr;
      });
      const next: Progress = { ...progress, manager, pending: { action, hash: prepared.hash } };
      save(next);
      const response = await fetch("/api/tx/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedXdr }) });
      const result = await response.json() as OwnerResult;
      if (result.hash && result.hash !== prepared.hash) throw new Error("Unexpected transaction receipt. Check the saved transaction hash.");
      await reconcile(next, result);
    });
  }

  return <>
    <ConsoleHeader><WalletButton address={address} owner={progress?.manager ?? address} disabled={busy} onConnect={next => { setAddress(next); setAccepted(false); }} /></ConsoleHeader>
    <main id="main" className="console-container flex max-w-3xl flex-col gap-6 py-8">
      <Link href="/" className="self-start text-sm underline">Back to console</Link>
      <div className="flex flex-col gap-2"><p className="text-xs text-muted-foreground">Stellar testnet · Vault manager setup</p><h1 className="text-2xl font-semibold">Start Kovan USDC yield</h1>
        <p className="text-sm text-muted-foreground">Create a DeFindex vault that supplies USDC to XOXNO lending. The connected wallet manages the vault. Once activated and registered, its shares can back Kovan agent budgets.</p></div>
      <ol className="grid gap-2 text-sm sm:grid-cols-3"><li>1. Create and seed</li><li>2. Activate lending</li><li>3. Enable in the console</li></ol>
      {!connected && address ? <p role="alert" className="text-sm text-destructive">Reconnect the saved vault manager: {progress?.manager}</p> : null}
      {progress?.pending ? <div className="flex flex-col gap-3 rounded-md border p-4">
        <p className="text-sm">Check the pending {progress.pending.action === "create" ? "creation" : "investment"} before proceeding.</p>
        <a href={`https://stellar.expert/explorer/testnet/tx/${progress.pending.hash}`} target="_blank" rel="noreferrer" className="break-all font-mono text-xs underline">{progress.pending.hash}</a>
        <Button disabled={busy} onClick={() => work(async () => { const result = await request<OwnerResult>({ action: "transaction", hash: progress.pending!.hash }); await reconcile(progress, result); })}>Check confirmation</Button>
      </div> : null}
      {progress?.creationHash ? <div className="flex flex-col gap-3 rounded-md border p-4">
        <a href={`https://stellar.expert/explorer/testnet/tx/${progress.creationHash}`} target="_blank" rel="noreferrer" className="text-sm underline">Confirmed vault creation</a>
        <Button variant="outline" disabled={busy || !!progress.pending} onClick={() => work(() => inspect(progress))}>Refresh vault allocation</Button>
        {inspection ? <>
          <a href={`https://stellar.expert/explorer/testnet/contract/${inspection.vault.vault}`} target="_blank" rel="noreferrer" className="break-all font-mono text-xs underline">{inspection.vault.vault}</a>
          <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Idle seed</dt><dd>{usdc(inspection.state.idle_amount)}</dd></div><div><dt className="text-muted-foreground">Invested in lending</dt><dd>{usdc(inspection.state.invested_amount)}</dd></div></dl>
          {inspection.state.hasActiveAllocation ? <p role="status" className="text-sm">{inspection.enabled ? "Vault enabled. Return to the console to configure a new pool before opening agents." : "Lending is active. The demo operator can now register this vault for the console."}</p> : <p className="text-sm">The vault is seeded but its funds are idle. Activate lending to start earning variable interest.</p>}
        </> : null}
      </div> : null}
      {!progress?.pending && (!progress?.creationHash || (inspection && !inspection.state.hasActiveAllocation)) ? <form className="flex flex-col gap-4 rounded-md border p-4" onSubmit={e => { e.preventDefault(); void transact(progress?.creationHash ? "activate" : "create"); }}>
        <Label htmlFor="seed">{progress?.creationHash ? "USDC to invest from the vault" : "USDC to seed from your wallet"}</Label>
        <Input id="seed" value={amount} onChange={e => { setAmount(e.target.value); setAccepted(false); }} inputMode="decimal" disabled={busy} required className="max-w-48 font-mono" />
        <p className="text-xs text-muted-foreground">Zero Kovan vault fee. The first 0.0001 shares remain locked as minimum liquidity. Creation leaves the seed idle until the separate investment transaction.</p>
        <label className="flex min-h-10 items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} /><span>I accept XOXNO lending and liquidity risk. Returns vary, and withdrawals depend on available liquidity. This setup uses testnet USDC.</span></label>
        <Button type="submit" disabled={busy || !connected || !accepted} className="self-start">{busy ? "Working…" : progress?.creationHash ? "Sign to activate lending" : "Sign to create and seed vault"}</Button>
        {!progress?.creationHash ? <p className="text-xs text-muted-foreground">Your wallet needs testnet XLM for fees and Circle testnet USDC. <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get test USDC</a>.</p> : null}
      </form> : null}
      {!progress?.creationHash && !progress?.pending ? <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); if (!address) return; void work(async () => { const next = { manager: address, creationHash: receipt.trim() }; await inspect(next); save(next); }); }}>
        <Label htmlFor="creation-receipt">Resume an existing setup with its creation transaction hash</Label>
        <Input id="creation-receipt" value={receipt} onChange={e => setReceipt(e.target.value)} disabled={busy} placeholder="64-character transaction hash" className="font-mono" />
        <Button variant="outline" type="submit" disabled={busy || !connected || !receipt} className="self-start">Verify and resume</Button>
      </form> : null}
      {inspection?.state.hasActiveAllocation && progress?.creationHash && !inspection.enabled ? <details className="rounded-md border p-4 text-sm"><summary className="cursor-pointer">Demo operator registration</summary><p className="my-3 text-muted-foreground">Run from the repository root after the testnet rehearsal. This verifies the committed vault before updating the local demo allowlist.</p><pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{`node dashboard/scripts/register-yield-vault.mjs --manager ${progress.manager} --creation-tx ${progress.creationHash}`}</pre></details> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </main>
  </>;
}
