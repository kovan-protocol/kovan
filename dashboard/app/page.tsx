"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentCard } from "@/components/AgentCard";
import { CreateAgentForm } from "@/components/CreateAgentForm";
import { PoolPanel } from "@/components/PoolPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchState, type LogEntry, type State } from "@/lib/client";
import type { CovenantArgs } from "@/lib/covenant-form";

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

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

  // Owner signing (Freighter) arrives in the next task; until then the form validates only.
  async function createAgent(args: CovenantArgs) {
    setLog((l) => [{ at: Date.now(), kind: "owner", label: `create_agent (${args.agent_pubkey.slice(0, 8)}…)`, ok: null, detail: "wallet signing not wired yet" }, ...l]);
    throw new Error("Owner signing is not wired yet (next task).");
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kovan console</h1>
          <p className="text-sm text-muted-foreground">Humans configure, agents only execute inside limits. Stellar testnet.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          Refresh
        </Button>
      </header>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span>Could not read the pool: {error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}

      <PoolPanel state={state} />

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
            state.agents.map((a) => <AgentCard key={a.id} agent={a} latestLedger={state.latestLedger} />)
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Create agent</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateAgentForm latestLedger={state?.latestLedger ?? 0} disabled={!state} disabledReason="Loading pool…" onSubmit={createAgent} />
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
                      <span>
                        {e.ok === null ? "…" : e.ok ? "✓" : "✗"} {e.label}
                      </span>
                      {e.detail ? <span className="text-muted-foreground">{e.detail}</span> : null}
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
