"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentActions } from "@/components/AgentActions";
import { AgentCard } from "@/components/AgentCard";
import { CreateAgentForm } from "@/components/CreateAgentForm";
import { PoolPanel } from "@/components/PoolPanel";
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

const EXPLORER = "https://stellar.expert/explorer/testnet";

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("1");

  const refresh = useCallback(async () => {
    try {
      setState(await fetchState());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const isOwner = !!state && !!address && address === state.ids.owner;

  async function owner<F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string) {
    if (!address) throw new Error("Connect Freighter first");
    const at = Date.now();
    setLog((l) => [{ at, kind: "owner", label, ok: null }, ...l]);
    const r = await runOwnerAction(fn, args, address);
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
    const r = await fetch(`/api/agent/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { hash?: string; status?: string; error?: string; stage?: string };
    const ok = r.ok && j.status === "SUCCESS";
    setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: j.hash || undefined, detail: ok ? undefined : `${j.stage ? j.stage + ": " : ""}${j.error ?? j.status}` } : e)));
    if (ok) await refresh();
    else throw new Error(j.error ?? j.status ?? "failed");
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
        <div className="flex items-center gap-2">
          <WalletButton address={address} owner={state?.ids.owner ?? null} onConnect={setAddress} />
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
                  <AgentActions agent={a} run={agentRun} />
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

          <Card>
            <CardHeader>
              <CardTitle>Log</CardTitle>
            </CardHeader>
            <CardContent>
              {log.length === 0 ? (
                <p className="text-sm text-muted-foreground">Transactions you send from here will appear with their result and explorer link.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {log.map((e) => (
                    <li key={e.at} className="flex flex-col font-mono text-xs">
                      <span className={e.ok === false ? "text-destructive" : undefined}>
                        {e.ok === null ? "…" : e.ok ? "✓" : "✗"} {e.label}
                      </span>
                      {e.detail ? <span className="text-muted-foreground">{e.detail}</span> : null}
                      {e.hash ? (
                        <a className="text-muted-foreground underline-offset-4 hover:underline" href={`${EXPLORER}/tx/${e.hash}`} target="_blank" rel="noreferrer">
                          {e.hash.slice(0, 10)}… on explorer
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
