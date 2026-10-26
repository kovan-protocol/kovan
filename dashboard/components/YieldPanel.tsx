"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { statusOf, type State } from "@/lib/client";
import { shortId, unitsFromUsdc, usdc } from "@/lib/format";
import type { OwnerArgs, OwnerFn } from "@/lib/owner";
import type { YieldAction, YieldQuote } from "@/lib/yield";

type Props = { state: State; isOwner: boolean; busy: boolean; onRun: <F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string) => Promise<void> };
// This adapter accepts only 7-decimal shares; shares are never denominated as USDC.
const shares = (n: string) => usdc(n).replace(" USDC", " shares");
const labels: Record<YieldAction, string> = { invest: "Invest pool USDC", lock_shares: "Lock existing shares", redeem_shares: "Redeem shares to pool" };

export function YieldPanel({ state, isOwner, busy, onRun }: Props) {
  const [action, setAction] = useState<YieldAction>("invest");
  const [amount, setAmount] = useState("1");
  const [recoveryAmount, setRecoveryAmount] = useState("");
  const [quote, setQuote] = useState<YieldQuote | null>(null);
  const [ack, setAck] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const y = state.yield;
  const supported = (state.pool.accounting_version ?? 1) >= 3;
  const vaults = state.yieldVaults ?? [];
  const candidate = vaults[0];
  const listed = vaults.some((v) => v.vault === y?.vault);
  const openAgents = state.agents.some((a) => statusOf(a.status) !== "Closed");
  const disabled = busy || running || !isOwner;
  const expired = !!quote && state.latestLedger > quote.validUntil;

  async function run<F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string) {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setRunning(true); setError(null); setMessage(null);
    try {
      await onRun(fn, args, label);
      setQuote(null); setAck(false);
      setMessage(`${label} confirmed. Balances have been refreshed.`);
    } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setRunning(false); }
  }
  async function preview(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setRunning(true); setError(null); setMessage(null); setQuote(null);
    try {
      const value = unitsFromUsdc(amount);
      if (value <= 0n) throw new Error("Enter an amount greater than zero");
      const r = await fetch("/api/yield/quote", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ pool: state.ids.pool, action, amount: value.toString() }) });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? "Quote unavailable; retry after refreshing");
      const q = result as YieldQuote;
      if (q.pool !== state.ids.pool || q.vault !== y?.vault || q.fn !== action) throw new Error("Pool or vault changed. Refresh and request a new quote.");
      setQuote(q); setAck(false);
    } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setRunning(false); }
  }
  function changeAction(value: YieldAction) { setAction(value); setQuote(null); setError(null); setAck(false); }

  return (
    <section aria-labelledby="yield-title" aria-busy={running} className="flex min-w-0 flex-col gap-3 border-t pt-4">
      <h3 id="yield-title" className="text-sm font-medium">Optional yield · DeFindex adapter</h3>
      <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <p><strong className="text-foreground">1. Invest from Kovan.</strong> Fund the pool with USDC, then choose how much to invest. Leave a cash buffer for payments.</p>
        <p><strong className="text-foreground">2. Bring a position.</strong> Lock supported vault shares in Kovan. The underlying stays in its external vault; control of the shares moves to this pool.</p>
      </div>
      {!supported ? <p className="rounded-md border p-3 text-sm">This deployed pool is cash-only. Both yield paths require the new v3 contract and a reviewed vault using the same USDC. Existing funds will not be migrated automatically.</p> : null}
      {supported && !candidate && !y?.vault ? <p className="rounded-md border p-3 text-sm">No compatible testnet vault is enabled. Cash funding still works. A matching vault must be verified before either yield path can be activated.</p> : null}
      {state.yieldError ? <p role="alert" className="text-sm text-destructive">{state.yieldError}</p> : null}
      {supported && y && !y.vault && candidate ? (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <p className="text-sm">Enable {candidate.name} for this pool? This one-time binding cannot be replaced. Configure it before opening agents.</p>
          <a className="break-all font-mono text-xs underline focus-visible:ring-2 focus-visible:ring-ring" href={`https://stellar.expert/explorer/testnet/contract/${candidate.vault}`} target="_blank" rel="noreferrer">{candidate.vault}</a>
          <RiskAcknowledgement checked={ack} onChange={setAck} disabled={disabled} />
          <Button className="min-h-10 self-start" disabled={disabled || !ack || openAgents || state.pool.closed} onClick={() => run("configure_yield", { vault: candidate.vault, wasm_hash: candidate.wasm_hash }, "Enable yield vault")}>Sign to enable vault</Button>
          {openAgents ? <p className="text-xs text-muted-foreground">Close existing agents first, or use a new pool.</p> : null}
        </div>
      ) : null}
      {supported && y?.vault ? (
        <>
          <a className="self-start font-mono text-xs underline focus-visible:ring-2 focus-visible:ring-ring" href={`https://stellar.expert/explorer/testnet/contract/${y.vault}`} target="_blank" rel="noreferrer">Vault {shortId(y.vault, 10)}</a>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Shares held by this pool</dt><dd className="font-mono">{y.share_balance_ok ? shares(y.shares) : "Unavailable"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Estimated external assets</dt><dd className="font-mono">{y.valuation_ok ? usdc(y.estimated_assets) : "Unavailable"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Counted toward budgets · {y.backing_bps / 100}%</dt><dd className="font-mono">{usdc(y.budget_backing)}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Estimated assets are not cash. Agent draws use liquid USDC first, then attempt redemption. If liquidity or backing is insufficient, the draw fails without consuming its limit. Yield and principal are not guaranteed.</p>
          {!y.valuation_ok ? <p role="alert" className="text-sm text-destructive">Vault valuation unavailable or code changed. Yield backing counts as zero. You can still revoke agents and return shares after their allocations close.</p> : null}
          {!listed ? <p className="text-xs text-muted-foreground">This vault is not enabled for new investments. Redemption and in-kind recovery remain available.</p> : null}
          <form onSubmit={preview} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="yield-action">Action</Label>
                <select id="yield-action" className="min-h-10 rounded-md border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" value={action} disabled={disabled} onChange={(e) => changeAction(e.target.value as YieldAction)}>
                  <option value="invest" disabled={!listed || state.pool.closed}>Invest pool USDC</option>
                  <option value="lock_shares" disabled={!listed || state.pool.closed}>Lock existing shares</option>
                  <option value="redeem_shares">Redeem shares to pool</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="yield-amount">{action === "invest" ? "Amount (USDC)" : "Amount (vault shares)"}</Label>
                <Input id="yield-amount" type="text" inputMode="decimal" autoComplete="off" required value={amount} disabled={disabled} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} aria-describedby="yield-amount-hint" className="min-h-10 w-40 font-mono" />
              </div>
              <Button className="min-h-10" type="submit" variant="outline" disabled={disabled || !y.valuation_ok || (action !== "redeem_shares" && (!listed || state.pool.closed))}>{running ? "Working…" : "Preview transaction"}</Button>
            </div>
            <p id="yield-amount-hint" className="text-xs text-muted-foreground">{action === "invest" ? `Available cash: ${usdc(state.pool.balance ?? "0")}. Investing is manual, never automatic.` : action === "lock_shares" ? "Enter shares held by the pool owner’s wallet, not their USDC value. No underlying withdrawal occurs." : "Redeemed USDC stays in Kovan. Use Withdraw separately to return unallocated cash to the owner."}</p>
          </form>
          {quote ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <p className="text-sm">{labels[quote.fn]} · estimated {quote.unit === "shares" ? shares(quote.expected) : usdc(quote.expected)}. {quote.fn === "lock_shares" ? "Minimum position value" : "Minimum received"}: {quote.unit === "shares" ? shares(quote.minimum) : usdc(quote.minimum)}.</p>
              <p className="text-xs text-muted-foreground">0.5% quote tolerance · valid through ledger {quote.validUntil}. The wallet transaction will be simulated again. {quote.fn === "lock_shares" ? "A minimum value check is not a liquidity guarantee." : ""}</p>
              {quote.fn !== "redeem_shares" ? <RiskAcknowledgement checked={ack} onChange={setAck} disabled={disabled} /> : null}
              {expired ? <p role="alert" className="text-sm text-destructive">Quote expired. Request a new preview.</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-10" disabled={disabled || expired || (quote.fn !== "redeem_shares" && !ack)} onClick={() => run(quote.fn, quote.args, labels[quote.fn])}>Sign {labels[quote.fn].toLowerCase()}</Button>
                <Button className="min-h-10" variant="outline" disabled={disabled} onClick={() => setQuote(null)}>Cancel</Button>
              </div>
            </div>
          ) : null}
          {!openAgents && y.share_balance_ok && BigInt(y.shares) > 0n ? (
            <div className="flex flex-col items-start gap-2 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Return {shares(y.shares)} to the original owner ({shortId(state.pool.owner)}), without selling them or closing the pool. This remains available when redemption is paused. Vault share transfers must still work.</p>
              <Button className="min-h-10" variant="outline" disabled={disabled} onClick={() => run("release_shares", { shares: y.shares }, "Return vault shares to owner")}>Sign return of all shares</Button>
            </div>
          ) : null}
          {!openAgents && !y.share_balance_ok ? <form className="flex flex-wrap items-end gap-3 rounded-md border p-3" onSubmit={(e) => {
            e.preventDefault();
            try {
              const value = unitsFromUsdc(recoveryAmount);
              if (value <= 0n) throw new Error("Enter a positive number of shares");
              void run("release_shares", { shares: value.toString() }, "Return vault shares to owner");
            } catch (err) { setError((err as Error).message); }
          }}>
            <p className="w-full text-xs text-muted-foreground">Share balance could not be verified. You may attempt an in-kind return to the original owner; this calls the current vault code. No redemption is attempted.</p>
            <div className="flex flex-col gap-1.5"><Label htmlFor="yield-recovery">Shares to return</Label><Input id="yield-recovery" type="text" inputMode="decimal" autoComplete="off" required value={recoveryAmount} onChange={(e) => setRecoveryAmount(e.target.value)} disabled={disabled} className="min-h-10 w-40 font-mono" /></div>
            <Button type="submit" className="min-h-10" variant="outline" disabled={disabled}>Sign share recovery</Button>
          </form> : null}
        </>
      ) : null}
      {supported && !isOwner ? <p className="text-xs text-muted-foreground">Connect the original pool owner’s wallet to manage yield.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error} Your input is preserved; you can retry.</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </section>
  );
}

function RiskAcknowledgement({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return <label className="flex min-h-10 items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" className="mt-0.5 size-4 accent-foreground focus-visible:ring-2 focus-visible:ring-ring" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span>I accept external vault, manager, strategy, and liquidity risk. Funds can lose value; only 90% of estimated vault assets backs budgets. This buffer is not insurance.</span></label>;
}
