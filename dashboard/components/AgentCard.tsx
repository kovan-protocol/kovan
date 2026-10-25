"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { statusOf, type StateAgent } from "@/lib/client";
import { shortId, usdc } from "@/lib/format";

const EXPLORER = "https://stellar.expert/explorer/testnet";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="font-mono text-sm tabular-nums">{v}</span>
    </div>
  );
}

function Addresses({ list }: { list: string[] }) {
  if (!list.length) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="flex flex-col items-end">
      {list.map((a) => (
        <span key={a} title={a}>
          {shortId(a, 6)}
        </span>
      ))}
    </span>
  );
}

export function AgentCard({ agent, latestLedger, actions }: { agent: StateAgent; latestLedger: number; actions?: React.ReactNode }) {
  const status = statusOf(agent.status);
  const c = agent.covenant;
  const expired = latestLedger >= c.expiry;
  const hoursLeft = Math.max(0, ((c.expiry - latestLedger) * 5) / 3600);
  const tone = status === "Active" ? (expired ? "secondary" : "default") : "destructive";
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate font-mono text-base">{shortId(agent.id, 8)}</CardTitle>
          <a
            className="text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`${EXPLORER}/contract/${agent.id}`}
            target="_blank"
            rel="noreferrer"
          >
            view on explorer
          </a>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={tone}>{expired && status === "Active" ? "Expired" : status}</Badge>
          {agent.parent ? <span className="text-xs text-muted-foreground">child of {shortId(agent.parent, 4)}</span> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Row k="Draw limit" v={usdc(agent.draw_limit)} />
          <Row k="Funding outstanding" v={usdc(agent.drawn)} />
          <Row k="Wallet balance" v={usdc(agent.balance)} />
          {status === "Closed" && agent.settled_spent !== undefined ? <Row k="Settled spending" v={usdc(agent.settled_spent)} /> : null}
          <Row k="Providers" v={<Addresses list={c.providers} />} />
          <Row k="Provider caps" v={`${usdc(c.provider_per_transfer_cap)} / ${usdc(c.provider_total_cap)}`} />
          {agent.state ? <Row k="Spent on providers" v={usdc(agent.state.provider_spent)} /> : null}
          <Row k="Recipients" v={<Addresses list={c.recipients} />} />
          {c.recipients.length ? <Row k="Recipient caps" v={`${usdc(c.recipient_per_transfer_cap)} / ${usdc(c.recipient_total_cap)}`} /> : null}
          <Row k="Calls" v={c.calls.length ? c.calls.map((x) => `${shortId(x.contract, 4)}.${x.fn_name}`).join(", ") : "none"} />
          <Row k="Expiry" v={expired ? `ledger ${c.expiry} (passed)` : `ledger ${c.expiry} · ~${hoursLeft.toFixed(1)} h`} />
          {agent.children.length ? <Row k="Children" v={<Addresses list={agent.children} />} /> : null}
        </div>
        {actions}
      </CardContent>
    </Card>
  );
}
