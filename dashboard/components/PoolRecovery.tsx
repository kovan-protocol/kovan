"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { statusOf, type State } from "@/lib/client";
import { usdc } from "@/lib/format";
import { withdrawable, type RecoveryMode } from "@/lib/pool-recovery";

type Props = { state: State; isOwner: boolean; busy: boolean; onRun: (mode: RecoveryMode) => Promise<string> };

export function PoolRecovery({ state, isOwner, busy, onRun }: Props) {
  const [confirm, setConfirm] = useState<RecoveryMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const uid = useId();
  const freeButton = useRef<HTMLButtonElement | null>(null);
  const withdrawButton = useRef<HTMLButtonElement | null>(null);
  const open = state.agents.filter((a) => statusOf(a.status) !== "Closed");
  const cash = withdrawable(state);
  const legacy = (state.pool.accounting_version ?? 1) < 2;
  const needsRecovery = open.length > 0 || state.agents.some((a) => BigInt(a.balance) > 0n);

  function cancel() {
    if (running) return;
    (confirm === "free" ? freeButton : withdrawButton).current?.focus();
    setConfirm(null);
  }

  async function execute() {
    if (!confirm || !isOwner || busy || inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await onRun(confirm));
      setConfirm(null);
    } catch (e) {
      setError(`${(e as Error).message} Confirmed transactions remain applied. Review the session log; you can retry to continue from the current state.`);
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  return (
    <section aria-labelledby={`${uid}-title`} aria-busy={running} className="flex flex-col gap-3 border-t pt-4">
      <h3 id={`${uid}-title`} className="text-sm font-medium">Free pool &amp; return funds</h3>
      <p className="text-xs text-muted-foreground">Free the pool to stop its agents and recover unspent USDC. Then return available funds to the original pool owner. Payments already made cannot be recovered.</p>
      <div className="flex flex-wrap gap-2">
        <Button ref={freeButton} type="button" variant="destructive" className="min-h-10" disabled={!isOwner || busy || running || !needsRecovery} aria-expanded={confirm === "free"} aria-controls={`${uid}-confirm`} onClick={() => { setConfirm("free"); setError(null); setMessage(null); }}>Free pool</Button>
        <Button ref={withdrawButton} type="button" variant="outline" className="min-h-10" disabled={!isOwner || busy || running || cash === 0n} aria-expanded={confirm === "withdraw"} aria-controls={`${uid}-confirm`} onClick={() => { setConfirm("withdraw"); setError(null); setMessage(null); }}>Return to wallet</Button>
      </div>
      <p className="text-xs text-muted-foreground">Available now: <span className="font-mono text-foreground">{usdc(cash)}</span></p>
      <div className="min-w-0 text-xs text-muted-foreground">Destination · pool owner<a className="mt-1 block break-all font-mono underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring" href={`https://stellar.expert/explorer/testnet/account/${state.pool.owner}`} target="_blank" rel="noreferrer">{state.pool.owner}</a></div>
      {!isOwner ? <p className="text-xs text-muted-foreground">Connect the pool owner’s wallet to recover or withdraw funds.</p> : null}
      {!needsRecovery && cash === 0n ? <p className="text-sm text-muted-foreground">No funds or open allocations to recover.</p> : null}
      {confirm ? (
        <div id={`${uid}-confirm`} className="flex flex-col gap-3 rounded-md border p-3" onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}>
          <p className="text-sm font-medium">{confirm === "free" ? `Stop ${open.length} open agent${open.length === 1 ? "" : "s"} and free the pool?` : "Return all available USDC to the owner?"}</p>
          <p className="text-xs text-muted-foreground">{confirm === "free" ? "Agents will be revoked, wallet balances recovered, and allocations released where the contract permits. Closure is permanent. You will approve separate transactions in Freighter; cancelling stops the remaining steps." : `This withdraws up to ${usdc(cash)} to the owner address above, without stopping agents. The amount is checked again before signing. Funds still allocated to agents stay in the pool.`}</p>
          {legacy && confirm === "free" ? <p className="text-xs text-muted-foreground">Legacy pool: spent advances remain recorded in revoked allocations. Unused limits will be reduced; parents blocked by an unclosed child may retain a minimum 0.0000001 USDC allocation. This does not mark those agents closed.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-10" disabled={running} onClick={cancel}>Cancel</Button>
            <Button type="button" variant={confirm === "free" ? "destructive" : "default"} className="min-h-10" disabled={!isOwner || busy || running} onClick={execute}>{running ? "Waiting for confirmations…" : confirm === "free" ? "Confirm free pool" : "Confirm return to wallet"}</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </section>
  );
}
