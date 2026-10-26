"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { statusOf, type State } from "@/lib/client";
import { usdc } from "@/lib/format";
import { supportsPoolClosure, withdrawable, type RecoveryMode } from "@/lib/pool-recovery";

type Props = { state: State; isOwner: boolean; busy: boolean; onRun: (mode: RecoveryMode) => Promise<string> };

export function PoolRecovery({ state, isOwner, busy, onRun }: Props) {
  const [confirm, setConfirm] = useState<RecoveryMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  const uid = useId();
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const recoverButton = useRef<HTMLButtonElement | null>(null);
  const withdrawButton = useRef<HTMLButtonElement | null>(null);
  const open = state.agents.filter((a) => statusOf(a.status) !== "Closed");
  const cash = withdrawable(state);
  const legacy = (state.pool.accounting_version ?? 1) < 2;
  const supportsClose = supportsPoolClosure(state);
  const closed = state.pool.closed === true;
  const needsRecovery = open.length > 0 || state.agents.some((a) => BigInt(a.balance) > 0n);

  function cancel() {
    if (running) return;
    (confirm === "close" ? closeButton : confirm === "recover" ? recoverButton : withdrawButton).current?.focus();
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
      <h3 id={`${uid}-title`} className="text-sm font-medium">Close pool &amp; return funds</h3>
      <p className="text-xs text-muted-foreground">{closed ? "This pool is permanently closed and cannot be reused. History remains on-chain. You can still recover USDC sent here later." : "Close the pool to stop all agents, recover unspent USDC, and return it to the original owner. This permanently disables the pool; it does not erase on-chain history."} Payments already made cannot be recovered.</p>
      <div className="flex flex-wrap gap-2">
        <Button ref={closeButton} type="button" variant="destructive" className="min-h-10" disabled={!isOwner || busy || running || !supportsClose || closed} aria-expanded={confirm === "close"} aria-controls={`${uid}-confirm`} onClick={() => { setConfirm("close"); setError(null); setMessage(null); }}>Close pool</Button>
        {!supportsClose || (closed && needsRecovery) ? <Button ref={recoverButton} type="button" variant="outline" className="min-h-10" disabled={!isOwner || busy || running || !needsRecovery} aria-expanded={confirm === "recover"} aria-controls={`${uid}-confirm`} onClick={() => { setConfirm("recover"); setError(null); setMessage(null); }}>Recover funds</Button> : null}
        <Button ref={withdrawButton} type="button" variant="outline" className="min-h-10" disabled={!isOwner || busy || running || cash === 0n} aria-expanded={confirm === "withdraw"} aria-controls={`${uid}-confirm`} onClick={() => { setConfirm("withdraw"); setError(null); setMessage(null); }}>Return to wallet</Button>
      </div>
      {!supportsClose ? <p className="text-xs text-muted-foreground">This deployed contract has no permanent shutdown function. Recover funds, then return them to your wallet. The old pool cannot be destroyed or marked closed on-chain; permanent closure requires a new deployment.</p> : null}
      <p className="text-xs text-muted-foreground">Available now: <span className="font-mono text-foreground">{usdc(cash)}</span></p>
      {state.yield?.vault ? <p className="text-xs text-muted-foreground">Closing returns vault shares in kind to the same owner; it does not redeem them for USDC. Redemption can be paused without preventing share recovery, provided the vault still permits transfers.</p> : null}
      <div className="min-w-0 text-xs text-muted-foreground">Destination · pool owner<a className="mt-1 block break-all font-mono underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring" href={`https://stellar.expert/explorer/testnet/account/${state.pool.owner}`} target="_blank" rel="noreferrer">{state.pool.owner}</a></div>
      {!isOwner ? <p className="text-xs text-muted-foreground">Connect the pool owner’s wallet to recover or withdraw funds.</p> : null}
      {!needsRecovery && cash === 0n ? <p className="text-sm text-muted-foreground">{supportsClose && !closed ? "The pool is empty. You can still close it permanently." : "No funds or open allocations to recover."}</p> : null}
      {confirm ? (
        <div id={`${uid}-confirm`} className="flex flex-col gap-3 rounded-md border p-3" onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}>
          <p className="text-sm font-medium">{confirm === "close" ? `Permanently close this pool and stop ${open.length} open agent${open.length === 1 ? "" : "s"}?` : confirm === "recover" ? "Recover agent funds to the pool?" : "Return all available USDC to the owner?"}</p>
          <p className="text-xs text-muted-foreground">{confirm === "close" ? "Agents will be revoked and closed, and unspent USDC recovered. The final transaction returns all remaining pool USDC to the owner address above and permanently disables funding and new agents. The pool cannot be reopened. You will approve separate transactions in Freighter; cancellation stops only the remaining steps." : confirm === "recover" ? "Agents will be revoked, wallet balances recovered, and allocations released where the contract permits. This does not close the pool or withdraw its cash. You will approve separate transactions in Freighter; cancelling stops the remaining steps." : `This withdraws up to ${usdc(cash)} to the owner address above, without stopping agents or closing the pool. The amount is checked again before signing. Funds still allocated to agents stay in the pool.`}</p>
          {legacy && confirm === "recover" ? <p className="text-xs text-muted-foreground">Legacy pool: spent advances remain recorded in revoked allocations. Unused limits will be reduced; parents blocked by an unclosed child may retain a minimum 0.0000001 USDC allocation. This does not mark those agents closed.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-10" disabled={running} onClick={cancel}>Cancel</Button>
            <Button type="button" variant={confirm === "close" ? "destructive" : "default"} className="min-h-10" disabled={!isOwner || busy || running || (confirm === "close" && (!supportsClose || closed))} onClick={execute}>{running ? "Waiting for confirmations…" : confirm === "close" ? "Confirm permanent closure" : confirm === "recover" ? "Confirm recovery" : "Confirm return to wallet"}</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </section>
  );
}
