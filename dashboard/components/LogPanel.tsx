"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LogEntry } from "@/lib/client";
import { shortId, usdc } from "@/lib/format";

const EXPLORER = "https://stellar.expert/explorer/testnet";

type ChainEvent = { ledger: number; txHash: string; source: "pool" | "covenant" | "other"; kind: string; agent?: string; vault?: string; action?: string; data: Record<string, string> | unknown };
type EventsPage = { events: ChainEvent[]; latestLedger: number; oldestLedger: number; truncated: boolean };

function describe(ev: ChainEvent): string {
  const d = (ev.data ?? {}) as Record<string, string>;
  const amt = (k: string) => (d[k] !== undefined ? usdc(d[k]) : "");
  switch (ev.kind) {
    case "funded":
      return `locked ${amt("amount")} · pool ${amt("locked")}`;
    case "withdrawn":
      return `withdrew ${amt("amount")} · pool ${amt("locked")}`;
    case "agent_created":
      return `draw limit ${amt("draw_limit")}`;
    case "drawn":
      return `${amt("amount")} · drawn ${amt("drawn")}`;
    case "returned":
      return `${amt("amount")} by ${shortId(d.by ?? "", 4)} · drawn ${amt("drawn")}`;
    case "revoked":
      return `by ${shortId(d.by ?? "", 4)}`;
    case "delegated":
      return `child ${shortId(d.child ?? "", 4)} · ${amt("draw_limit")}`;
    case "amended":
      return `draw limit ${amt("draw_limit")}`;
    case "closed":
      return d.consumed === undefined ? "allocation closed" : `recovered ${amt("recovered")} · consumed ${amt("consumed")} · released ${amt("released")}`;
    case "settlement_requested":
      return "spending stopped; awaiting closure";
    case "pool_closed":
      return `pool permanently closed · returned ${amt("returned")} to owner`;
    case "yield_configured":
      return "owner enabled a fixed vault binding";
    case "yield_movement":
      return `${ev.action ?? "yield"} · ${usdc(d.shares ?? "0").replace(" USDC", " shares")}${ev.action === "release" ? " returned in kind" : ` · ${amt("assets")}`}`;
    default:
      return typeof ev.data === "object" && ev.data ? Object.keys(ev.data as object).join(", ") : "";
  }
}

export function LogPanel({ session, pool }: { session: LogEntry[]; pool?: string | null }) {
  const [page, setPage] = useState<EventsPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/events${pool ? `?pool=${pool}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setPage(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pool]);

  useEffect(() => {
    const initial = setTimeout(load, 0);
    const t = setInterval(load, 20_000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [load, session.length]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Log</CardTitle>
        <Button variant="ghost" size="sm" onClick={load}>
          Reload
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">This session</h3>
          {session.length === 0 ? (
            <p className="text-sm text-muted-foreground">Transactions you send from here appear with their result and explorer link.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 font-mono text-xs">
              {session.map((e) => (
                <li key={e.at} className="flex flex-col">
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
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">On-chain events</h3>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : !page ? (
            <div className="h-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          ) : page.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events in the last ~24 h.</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto font-mono text-xs">
              {page.events.map((ev, i) => (
                <li key={`${ev.txHash}-${i}`} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Badge variant={ev.source === "covenant" ? "secondary" : "outline"} className="font-mono text-[10px]">
                      {ev.source}
                    </Badge>
                    <span>{ev.kind}</span>
                    {ev.agent ? <span className="text-muted-foreground">{shortId(ev.agent, 4)}</span> : null}
                    {ev.vault ? <span className="text-muted-foreground">vault {shortId(ev.vault, 4)}</span> : null}
                  </span>
                  <span className="text-muted-foreground">
                    {describe(ev)} ·{" "}
                    <a className="underline-offset-4 hover:underline" href={`${EXPLORER}/tx/${ev.txHash}`} target="_blank" rel="noreferrer">
                      ledger {ev.ledger}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {page?.truncated ? <p className="text-xs text-muted-foreground">Older events unavailable before ledger {page.oldestLedger} (RPC retention).</p> : null}
        </section>
      </CardContent>
    </Card>
  );
}
