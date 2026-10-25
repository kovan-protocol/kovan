"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StateAgent } from "@/lib/client";
import { unitsFromUsdc, usdc } from "@/lib/format";

export type AgentRun = (action: "draw" | "pay" | "return", body: { agent: string; amount: string; to?: string }, label: string) => Promise<void>;

/** Agent-side buttons: these are signed by the server with AGENT_SECRET, never by Freighter. */
export function AgentActions({ agent, run }: { agent: StateAgent; run: AgentRun }) {
  const [amount, setAmount] = useState("0.1");
  const [to, setTo] = useState(agent.covenant.providers[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const uid = `a-${agent.id.slice(0, 6)}`;

  async function go(action: "draw" | "pay" | "return", label: string, payee?: string) {
    setErr(null);
    let units: bigint;
    try {
      units = unitsFromUsdc(amount);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setBusy(label);
    try {
      await run(action, { agent: agent.id, amount: units.toString(), to: payee }, `${label} · ${usdc(units)}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const active = (Array.isArray(agent.status) ? agent.status[0] : agent.status) === "Active";
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <p className="text-xs text-muted-foreground">Agent actions · signed by the agent key on the server</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-amt`}>Amount (USDC)</Label>
          <Input id={`${uid}-amt`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-to`}>Pay to</Label>
          <Input id={`${uid}-to`} value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} className="font-mono text-xs" placeholder="G… or C…" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!!busy || !active} onClick={() => go("draw", "draw")}>
          {busy === "draw" ? "Drawing…" : "Draw from pool"}
        </Button>
        <Button size="sm" variant="secondary" disabled={!!busy || !active || !to} onClick={() => go("pay", "pay", to)}>
          {busy === "pay" ? "Paying…" : "Pay"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => go("return", "return_funds")}>
          {busy === "return_funds" ? "Returning…" : "Return to pool"}
        </Button>
      </div>
      {err ? (
        <p role="alert" className="font-mono text-xs text-destructive">
          {err}
        </p>
      ) : null}
    </div>
  );
}
