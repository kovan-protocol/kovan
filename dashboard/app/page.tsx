"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentActions } from "@/components/AgentActions";
import { AgentCard } from "@/components/AgentCard";
import { CreateAgentForm } from "@/components/CreateAgentForm";
import { LogPanel } from "@/components/LogPanel";
import { PoolPanel } from "@/components/PoolPanel";
import { loadPools, PoolSelector, savePool } from "@/components/PoolSelector";
import { WalletButton } from "@/components/WalletButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchState, type LogEntry, type State } from "@/lib/client";
import type { CovenantArgs } from "@/lib/covenant-form";
import { unitsFromUsdc, usdc } from "@/lib/format";
import type { OwnerArgs, OwnerFn } from "@/lib/owner";
import { runOwnerAction } from "@/lib/wallet";

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("1");
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
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const isOwner = !!state && !!address && address === state.pool.owner;

  function selectPool(id: string) {
    setState(null);
    setPool(id);
  }

  async function createPool() {
    if (!address) return;
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

  async function owner<F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string) {
    if (!address) throw new Error("Connect Freighter first");
    const at = Date.now();
    setLog((l) => [{ at, kind: "owner", label, ok: null }, ...l]);
    const r = await runOwnerAction(fn, args, address, pool);
    const ok = r.status === "SUCCESS";
    setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: r.hash, detail: ok ? undefined : r.error } : e)));
    if (ok) await refresh();
    else throw new Error(r.error ?? r.status);
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

  const ownerDisabledReason = !address ? "Connect Freighter to sign as the owner." : !isOwner ? "Connected key is not the pool owner." : undefined;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kovan console</h1>
          <p className="text-sm text-muted-foreground">Humans configure, agents only execute inside limits. Stellar testnet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PoolSelector pools={pools} current={pool} onSelect={selectPool} onCreate={createPool} canCreate={!!address} creating={creatingPool} />
          <WalletButton address={address} owner={state?.pool.owner ?? null} onConnect={setAddress} />
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
            <Input id="fund-amount" inputMode="decimal" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} className="w-40 font-mono" />
          </div>
          <Button type="submit" disabled={!isOwner}>
            Fund
          </Button>
          {ownerDisabledReason ? <span className="text-xs text-muted-foreground">{ownerDisabledReason}</span> : null}
        </form>
      </PoolPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
                  <AgentActions agent={a} run={agentRun} payX402={payX402} />
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isOwner || BigInt(a.balance) === 0n}
                      onClick={() => owner("return_funds", { agent: a.id, by: address!, amount: a.balance }, `return_funds · ${usdc(a.balance)} from ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      Return all funds
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!isOwner || a.status[0] === "Revoked" || a.status[0] === "Closed"}
                      onClick={() => owner("revoke", { agent: a.id, by: address! }, `revoke · ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      Revoke
                    </Button>
                  </div>
                  </>
                }
              />
            ))
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Create agent</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateAgentForm latestLedger={state?.latestLedger ?? 0} disabled={!isOwner} disabledReason={ownerDisabledReason} onSubmit={createAgent} />
            </CardContent>
          </Card>

          <LogPanel session={log} pool={pool} />
        </aside>
      </div>
    </main>
  );
}
