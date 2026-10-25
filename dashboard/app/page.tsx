"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentActions } from "@/components/AgentActions";
import { AgentCard } from "@/components/AgentCard";
import { AgentSigner } from "@/components/AgentSigner";
import { CreateAgentForm } from "@/components/CreateAgentForm";
import { LogPanel } from "@/components/LogPanel";
import { PoolPanel } from "@/components/PoolPanel";
import { PoolRecovery } from "@/components/PoolRecovery";
import { loadPools, PoolSelector, savePool } from "@/components/PoolSelector";
import { WalletButton } from "@/components/WalletButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchState, statusOf, type LogEntry, type State } from "@/lib/client";
import type { CovenantArgs } from "@/lib/covenant-form";
import { unitsFromUsdc, usdc } from "@/lib/format";
import type { OwnerArgs, OwnerFn } from "@/lib/owner";
import { runPoolRecovery, withdrawable, type RecoveryMode } from "@/lib/pool-recovery";
import { runOwnerAction } from "@/lib/wallet";

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("1");
  const [withdrawAmount, setWithdrawAmount] = useState("1");
  const [pendingOwner, setPendingOwner] = useState<string | null>(null);
  const ownerInFlight = useRef(false);
  const [pools, setPools] = useState<string[]>([]);
  const [pool, setPool] = useState<string | null>(null);
  const [creatingPool, setCreatingPool] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const st = await fetchState(pool);
      setState(st);
      setError(null);
      // first load: learn the default pool id from the server and merge saved pools
      setPools((prev) => (prev.length ? prev : loadPools(st.ids.pool)));
      setPool((prev) => prev ?? st.ids.pool);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pool]);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const t = setInterval(refresh, 15_000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [refresh]);

  const isOwner = !!state && !!address && address === state.pool.owner;

  function selectPool(id: string) {
    if (ownerInFlight.current) return;
    setState(null);
    setPool(id);
  }

  async function createPool() {
    if (!address || ownerInFlight.current) return;
    setCreatingPool(true);
    const at = Date.now();
    setLog((l) => [{ at, kind: "owner", label: "create_pool", ok: null }, ...l]);
    try {
      const r = await runOwnerAction("create_pool", {}, address, pool);
      const ok = r.status === "SUCCESS";
      const newId = ok && typeof r.returnValue === "string" ? r.returnValue : undefined;
      setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: r.hash, detail: ok ? `new pool ${newId ?? ""}` : r.error } : e)));
      if (newId) {
        savePool(newId);
        setPools((p) => (p.includes(newId) ? p : [...p, newId]));
        selectPool(newId);
      } else if (!ok) {
        setError(r.error ?? "create_pool failed");
      }
    } finally {
      setCreatingPool(false);
    }
  }

  async function submitOwner<F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string, source: string, poolId: string) {
    setPendingOwner(label);
    const at = Date.now();
    setLog((l) => [{ at, kind: "owner", label, ok: null }, ...l]);
    try {
      const r = await runOwnerAction(fn, args, source, poolId);
      const ok = r.status === "SUCCESS";
      setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: r.hash, detail: ok ? undefined : r.error } : e)));
      if (!ok) throw new Error(r.error ?? r.status);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      setLog((l) => l.map((e) => e.at === at ? { ...e, ok: false, detail: message } : e));
      throw err;
    }
  }

  async function owner<F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string) {
    if (!address || !isOwner || !state) throw new Error("Connect the pool owner's wallet first");
    if (ownerInFlight.current) throw new Error("Wait for the current owner transaction to finish");
    ownerInFlight.current = true;
    try {
      await submitOwner(fn, args, label, address, state.ids.pool);
      await refresh();
    } finally {
      ownerInFlight.current = false;
      setPendingOwner(null);
    }
  }

  async function recoverPool(mode: RecoveryMode): Promise<string> {
    if (!address || !isOwner || !state) throw new Error("Connect the pool owner's wallet first");
    if (ownerInFlight.current || creatingPool) throw new Error("Wait for the current owner transaction to finish");
    const poolId = state.ids.pool;
    const source = address;
    ownerInFlight.current = true;
    setPendingOwner("Checking current pool balances");
    setError(null);
    try {
      const result = await runPoolRecovery({
        mode, pool: poolId, owner: source,
        read: async () => {
          const fresh = await fetchState(poolId);
          if (fresh.ids.pool === poolId) setState(fresh);
          return fresh;
        },
        run: (step) => submitOwner(step.fn, step.args, step.label, source, poolId),
      });
      if (mode === "withdraw") return "Available USDC returned to the original pool owner’s wallet. See the session log for the transaction.";
      const remaining = result.state.agents.filter((a) => statusOf(a.status) !== "Closed").length;
      return remaining
        ? `Unspent funds recovered and unused limits released. ${remaining} legacy allocation(s) remain revoked, not closed. ${usdc(withdrawable(result.state))} is available via Return to wallet.`
        : `Agents closed and unspent funds recovered. ${usdc(withdrawable(result.state))} is available via Return to wallet.`;
    } finally {
      ownerInFlight.current = false;
      setPendingOwner(null);
    }
  }

  async function createAgent(a: CovenantArgs) {
    const covenant = {
      ...a.covenant,
      provider_per_transfer_cap: a.covenant.provider_per_transfer_cap.toString(),
      provider_total_cap: a.covenant.provider_total_cap.toString(),
      recipient_per_transfer_cap: a.covenant.recipient_per_transfer_cap.toString(),
      recipient_total_cap: a.covenant.recipient_total_cap.toString(),
      calls: a.covenant.calls.map((c) => ({ ...c, amount_cap: c.amount_cap.toString() })),
    };
    await owner("create_agent", { agent_pubkey: a.agent_pubkey, draw_limit: a.draw_limit.toString(), covenant }, `create_agent · limit ${usdc(a.draw_limit)}`);
  }

  async function agentRun(action: "draw" | "pay" | "return", body: { agent: string; amount: string; to?: string }, label: string) {
    if (ownerInFlight.current) throw new Error("Wait for the owner transaction or pool recovery to finish");
    const at = Date.now();
    setLog((l) => [{ at, kind: "agent", label: `${label} (${body.agent.slice(0, 6)})`, ok: null }, ...l]);
    const r = await fetch(`/api/agent/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pool }) });
    const j = (await r.json()) as { hash?: string; status?: string; error?: string; stage?: string };
    const ok = r.ok && j.status === "SUCCESS";
    setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: j.hash || undefined, detail: ok ? undefined : `${j.stage ? j.stage + ": " : ""}${j.error ?? j.status}` } : e)));
    if (ok) await refresh();
    else throw new Error(j.error ?? j.status ?? "failed");
  }

  async function payX402(agent: string, url: string, label: string) {
    if (ownerInFlight.current) throw new Error("Wait for the owner transaction or pool recovery to finish");
    const at = Date.now();
    setLog((l) => [{ at, kind: "agent", label: `${label} (${agent.slice(0, 6)}) ${url}`, ok: null }, ...l]);
    const r = await fetch("/api/x402", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, url }) });
    const j = (await r.json()) as { ok: boolean; txHash?: string; body?: string; error?: string; stage?: string; terms?: import("@/components/AgentActions").X402Terms };
    setLog((l) => l.map((e) => (e.at === at ? { ...e, ok: !!j.ok, hash: j.txHash, detail: j.ok ? `paid ${j.terms ? usdc(j.terms.amount) : ""}` : `${j.stage ? j.stage + ": " : ""}${j.error ?? "failed"}` } : e)));
    if (j.ok) await refresh();
    return j;
  }

  async function fund(e: React.FormEvent) {
    e.preventDefault();
    try {
      const amount = unitsFromUsdc(fundAmount);
      await owner("fund", { amount: amount.toString() }, `fund · ${usdc(amount)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    try {
      const amount = unitsFromUsdc(withdrawAmount);
      if (!state || amount <= 0n || amount > withdrawable(state)) {
        throw new Error("Amount exceeds funds available to withdraw");
      }
      await owner("withdraw", { amount: amount.toString() }, `withdraw · ${usdc(amount)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const ownerDisabledReason = !address ? "Connect Freighter to sign as the owner." : !isOwner ? "Connected key is not the pool owner." : undefined;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kovan console</h1>
          <p className="text-sm text-muted-foreground">Humans configure, agents only execute inside limits. Stellar testnet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PoolSelector pools={pools} current={pool} onSelect={selectPool} onCreate={createPool} canCreate={!!address && !pendingOwner} creating={creatingPool} disabled={!!pendingOwner} />
          <WalletButton address={address} owner={state?.pool.owner ?? null} onConnect={setAddress} disabled={!!pendingOwner || creatingPool} />
          <Button variant="outline" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </header>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => { setError(null); refresh(); }}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <PoolPanel state={state}>
        <form onSubmit={fund} className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fund-amount">Lock USDC in the pool</Label>
            <Input id="fund-amount" inputMode="decimal" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} disabled={!!pendingOwner} className="w-40 font-mono" />
          </div>
          <Button type="submit" disabled={!isOwner || !!pendingOwner}>
            Fund
          </Button>
          {ownerDisabledReason ? <span className="text-xs text-muted-foreground">{ownerDisabledReason}</span> : null}
        </form>
        <form onSubmit={withdraw} className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="withdraw-amount">Withdraw available USDC</Label>
            <Input id="withdraw-amount" inputMode="decimal" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} disabled={!!pendingOwner} className="w-40 font-mono" />
          </div>
          <Button type="submit" variant="outline" disabled={!isOwner || !!pendingOwner || !state || withdrawable(state) === 0n}>
            Withdraw
          </Button>
        </form>
        {state ? <PoolRecovery key={state.ids.pool} state={state} isOwner={isOwner} busy={!!pendingOwner || creatingPool} onRun={recoverPool} /> : null}
        {pendingOwner ? <p role="status" className="text-sm text-muted-foreground">Waiting for wallet approval or confirmation: {pendingOwner}</p> : null}
      </PoolPanel>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Agents</h2>
          {!state ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          ) : state.agents.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">No agents yet. Create one with the form.</CardContent>
            </Card>
          ) : (
            state.agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                latestLedger={state.latestLedger}
                actions={
                  <>
                  <AgentSigner agent={a} owner={address} pool={state.ids.pool} isOwner={isOwner} />
                  {a.signing?.mode !== "external" ? <AgentActions agent={a} run={agentRun} payX402={payX402} latestLedger={state.latestLedger} disabled={!!pendingOwner} /> : null}
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isOwner || !!pendingOwner || BigInt(a.balance) === 0n}
                      onClick={() => owner("return_funds", { agent: a.id, by: address!, amount: a.balance }, `return_funds · ${usdc(a.balance)} from ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      Return all funds
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!isOwner || !!pendingOwner || statusOf(a.status) === "Revoked" || statusOf(a.status) === "Closed"}
                      onClick={() => owner("revoke", { agent: a.id, by: address! }, `revoke · ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      Revoke
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isOwner || !!pendingOwner || statusOf(a.status) === "Closed" || a.children.some((id) => !state.agents.some((child) => child.id === id && statusOf(child.status) === "Closed")) || ((state.pool.accounting_version ?? 1) < 2 && BigInt(a.drawn) !== 0n)}
                      onClick={() => owner("close", { agent: a.id, by: address! }, `close · ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      {(state.pool.accounting_version ?? 1) >= 2 ? "Recover & close" : "Close allocation"}
                    </Button>
                  </div>
                  {statusOf(a.status) !== "Closed" && (state.pool.accounting_version ?? 1) >= 2 ? (
                    <p className="text-xs text-muted-foreground">Recover &amp; close permanently stops this agent, returns its wallet balance, and releases unused allocation. Close any child agents first.</p>
                  ) : null}
                  </>
                }
              />
            ))
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Create agent</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateAgentForm latestLedger={state?.latestLedger ?? 0} disabled={!isOwner || !!pendingOwner} disabledReason={pendingOwner ? "Wait for the current owner transaction." : ownerDisabledReason} onSubmit={createAgent} owner={isOwner ? address : null} pool={state?.ids.pool ?? null} />
            </CardContent>
          </Card>

          <LogPanel session={log} pool={pool} />
        </aside>
      </div>
    </main>
  );
}
