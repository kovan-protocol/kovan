"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usdc, shortId } from "@/lib/format";
import type { State } from "@/lib/client";
import { withdrawable } from "@/lib/pool-recovery";

const EXPLORER = "https://stellar.expert/explorer/testnet";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-lg tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function PoolPanel({ state, children }: { state: State | null; children?: React.ReactNode }) {
  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pool</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }
  const sum = BigInt(state.pool.sum_limits);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Pool</CardTitle>
          <a
            className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`${EXPLORER}/contract/${state.ids.pool}`}
            target="_blank"
            rel="noreferrer"
          >
            {shortId(state.ids.pool, 8)}
          </a>
        </div>
        <Badge variant="outline">testnet · ledger {state.latestLedger.toLocaleString("en-US")}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {state.pool.closed ? <p role="status" className="rounded-md border p-3 text-sm"><strong>Permanently closed.</strong> Funding and new agents are disabled on-chain. This pool is kept here for history and late refunds. Use New pool to start again.</p> : null}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="In the pool" value={state.pool.balance === undefined ? "—" : usdc(state.pool.balance)} hint="USDC held by the pool" />
          <Stat label="Allocated limits" value={usdc(sum)} hint="includes advances until closed" />
          <Stat label="Free to withdraw" value={state.pool.balance === undefined ? "—" : usdc(withdrawable(state))} />
          <Stat label="Settled spending" value={state.pool.settled_spent === undefined ? "—" : usdc(state.pool.settled_spent)} hint="net funding consumed by closed agents" />
        </div>
        {(state.pool.accounting_version ?? 1) < 2 ? (
          <p className="text-sm text-muted-foreground">This pool uses earlier accounting. Recover funds can recover unspent funds and reduce unused allocations, but allocations with spent advances remain revoked rather than closed.</p>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}
