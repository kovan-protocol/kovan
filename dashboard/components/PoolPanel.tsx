"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usdc, shortId } from "@/lib/format";
import type { State } from "@/lib/client";
import { withdrawable } from "@/lib/pool-recovery";

const EXPLORER = "https://stellar.expert/explorer/testnet";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="pool-stat">
      <span className="pool-stat-label">{label}</span>
      <span className="pool-stat-value">{value}</span>
      {hint ? <span className="pool-stat-hint">{hint}</span> : null}
    </div>
  );
}

export function PoolPanel({ state, children }: { state: State | null; children?: React.ReactNode }) {
  if (!state) {
    return (
      <Card id="overview" aria-busy="true" aria-label="Loading pool overview">
        <CardHeader>
          <CardTitle>Pool overview</CardTitle>
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
    <Card id="overview">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle><h2>Pool overview</h2></CardTitle>
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
        <p className="text-xs text-muted-foreground">{typeof state.pool.closed === "boolean" ? `Owner-controlled recovery${(state.pool.accounting_version ?? 1) >= 3 ? " · Optional yield available" : " · Cash pool"}` : "Legacy contract · no permanent shutdown; use New pool for the current contract"}</p>
        {state.pool.closed ? <p role="status" className="rounded-md border p-3 text-sm"><strong>Permanently closed.</strong> Funding and new agents are disabled on-chain. This pool is kept here for history and late refunds. Use New pool to start again.</p> : null}
        <div className="pool-stats">
          <Stat label="Liquid in the pool" value={state.pool.balance === undefined ? "—" : usdc(state.pool.balance)} hint="USDC cash, excluding vault shares" />
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
