"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StateAgent } from "@/lib/client";
import { unitsFromUsdc, usdc } from "@/lib/format";
import { X402_TESTNET_EXAMPLE } from "@/lib/covenant-examples";

export type AgentRun = (action: "draw" | "pay" | "return", body: { agent: string; amount: string; to?: string }, label: string) => Promise<void>;
export type X402Terms = { url: string; description?: string; payTo: string; amount: string; asset: string; maxTimeoutSeconds: number };
export type X402Pay = (agent: string, url: string, label: string) => Promise<{ ok: boolean; body?: string; txHash?: string; error?: string; terms?: X402Terms }>;

/** Agent-side buttons: these are signed by the server with AGENT_SECRET, never by Freighter. */
export function AgentActions({ agent, run, payX402, latestLedger, disabled }: { agent: StateAgent; run: AgentRun; payX402: X402Pay; latestLedger: number; disabled?: boolean }) {
  const [amount, setAmount] = useState("0.1");
  const [url, setUrl] = useState<string>(X402_TESTNET_EXAMPLE.url);
  const [terms, setTerms] = useState<X402Terms | null>(null);
  const [response, setResponse] = useState<string | null>(null);
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

  async function checkTerms() {
    setErr(null);
    setTerms(null);
    setResponse(null);
    setBusy("terms");
    try {
      const r = await fetch(`/api/x402?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not read terms");
      setTerms(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function payUrl() {
    setErr(null);
    setResponse(null);
    setBusy("x402");
    try {
      const r = await payX402(agent.id, url, "x402 pay");
      if (r.terms) setTerms(r.terms);
      if (r.ok) setResponse(r.body ?? "(empty body)");
      else setErr(r.error ?? "payment failed");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const payeeAllowed = terms ? agent.covenant.providers.includes(terms.payTo) || agent.covenant.recipients.includes(terms.payTo) : null;
  const active = (Array.isArray(agent.status) ? agent.status[0] : agent.status) === "Active" && latestLedger < agent.covenant.expiry && !agent.state?.revoked;
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
        <Button size="sm" disabled={disabled || !!busy || !active} onClick={() => go("draw", "draw")}>
          {busy === "draw" ? "Drawing…" : "Draw from pool"}
        </Button>
        <Button size="sm" variant="secondary" disabled={disabled || !!busy || !active || !to} onClick={() => go("pay", "pay", to)}>
          {busy === "pay" ? "Paying…" : "Pay"}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled || !!busy} onClick={() => go("return", "return_funds")}>
          {busy === "return_funds" ? "Returning…" : "Return to pool"}
        </Button>
      </div>
      <div className="flex flex-col gap-2 rounded-md border p-3">
        <Label htmlFor={`${uid}-url`}>Pay an x402 endpoint</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={`${uid}-url`} value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} className="font-mono text-xs" placeholder="https://…" />
          <Button size="sm" variant="outline" disabled={!!busy || !url} onClick={checkTerms}>
            {busy === "terms" ? "Reading…" : "Read terms"}
          </Button>
          <Button size="sm" disabled={disabled || !!busy || !active || !url} onClick={payUrl}>
            {busy === "x402" ? "Paying…" : "Pay endpoint"}
          </Button>
        </div>
        {terms ? (
          <p className="font-mono text-xs text-muted-foreground">
            wants {usdc(terms.amount)} → {terms.payTo.slice(0, 6)}…{terms.payTo.slice(-4)} ·{" "}
            {payeeAllowed ? <span className="text-foreground">payee is allowlisted</span> : <span className="text-destructive">payee is NOT on this covenant; the policy will refuse</span>}
          </p>
        ) : null}
        {response ? <pre className="max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-xs">{response}</pre> : null}
      </div>
      {err ? (
        <p role="alert" className="font-mono text-xs text-destructive">
          {err}
        </p>
      ) : null}
    </div>
  );
}
