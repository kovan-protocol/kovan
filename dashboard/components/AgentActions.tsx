"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StateAgent } from "@/lib/client";
import { unitsFromUsdc, usdc } from "@/lib/format";
import { X402_TESTNET_EXAMPLE } from "@/lib/covenant-examples";
import { paymentIdForRequest, type PaymentRequest } from "@kovan-protocol/sdk";

export type AgentRun = (action: "draw" | "pay" | "return", body: { agent: string; amount: string; to?: string; payment?: PaymentRequest }, label: string) => Promise<void>;
export type X402Terms = { url: string; description?: string; payTo: string; amount: string; asset: string; maxTimeoutSeconds: number; quoteId: string };
export type X402Pay = (agent: string, url: string, label: string, approval: { quoteId: string; requestId: string; mandateId?: string }) => Promise<{ ok: boolean; body?: string; txHash?: string; error?: string; terms?: X402Terms }>;

/** Agent-side buttons: these are signed by the server with AGENT_SECRET, never by Freighter. */
export function AgentActions({ agent, run, payX402, latestLedger, disabled }: { agent: StateAgent; run: AgentRun; payX402: X402Pay; latestLedger: number; disabled?: boolean }) {
  const [amount, setAmount] = useState("0.1");
  const [url, setUrl] = useState<string>(X402_TESTNET_EXAMPLE.url);
  const [terms, setTerms] = useState<X402Terms | null>(null);
  const [mandateId, setMandateId] = useState("");
  const [reference, setReference] = useState("");
  const directRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const [directPaymentId, setDirectPaymentId] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const [onchainPaymentId, setOnchainPaymentId] = useState<string | null>(null);
  const paymentInFlight = useRef(false);
  const [response, setResponse] = useState<string | null>(null);
  const [to, setTo] = useState(agent.covenant.providers[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const uid = `a-${agent.id.slice(0, 6)}`;

  async function go(action: "draw" | "pay" | "return", label: string, payee?: string) {
    if (paymentInFlight.current) return;
    setErr(null);
    let units: bigint;
    try {
      units = unitsFromUsdc(amount);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    paymentInFlight.current = true;
    setBusy(label);
    try {
      let payment: PaymentRequest | undefined;
      if (action === "pay" && mandateId) {
        const fingerprint = JSON.stringify([mandateId, payee, units.toString(), reference]);
        if (directRequest.current?.fingerprint !== fingerprint) directRequest.current = { fingerprint, id: crypto.randomUUID() };
        payment = { mandateId, paymentId: paymentIdForRequest(directRequest.current.id), reference };
        setDirectPaymentId(payment.paymentId);
      }
      await run(action, { agent: agent.id, amount: units.toString(), to: payee, ...(payment ? { payment } : {}) }, `${label} · ${usdc(units)}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      paymentInFlight.current = false;
      setBusy(null);
    }
  }

  async function checkTerms() {
    if (paymentInFlight.current) return;
    setErr(null);
    setTerms(null);
    requestId.current = null;
    setResponse(null);
    setBusy("terms");
    try {
      const r = await fetch(`/api/x402?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not read terms");
      requestId.current = crypto.randomUUID();
      setOnchainPaymentId(paymentIdForRequest(requestId.current));
      setTerms(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function payUrl() {
    if (paymentInFlight.current || !terms || !requestId.current) return;
    paymentInFlight.current = true;
    setErr(null);
    setResponse(null);
    setBusy("x402");
    try {
      const r = await payX402(agent.id, terms.url, "x402 pay", { quoteId: terms.quoteId, requestId: requestId.current, ...(mandateId ? { mandateId } : {}) });
      if (r.ok) setResponse(r.body ?? "(empty body)");
      else setErr(r.error ?? "payment failed");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      paymentInFlight.current = false;
      setBusy(null);
    }
  }

  const payeeAllowed = terms ? agent.covenant.providers.includes(terms.payTo) || agent.covenant.recipients.includes(terms.payTo) : null;
  const active = (Array.isArray(agent.status) ? agent.status[0] : agent.status) === "Active" && latestLedger < agent.covenant.expiry && !agent.state?.revoked;
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <p className="text-xs text-muted-foreground">Agent actions · signed by the agent key on the server</p>
      <Label htmlFor={`${uid}-mandate`}>Mandate ID · required for new agents</Label>
      <Input id={`${uid}-mandate`} value={mandateId} disabled={!!busy} onChange={e => { setMandateId(e.target.value.trim().toLowerCase()); setTerms(null); requestId.current = null; }} className="font-mono text-xs" placeholder="64 hex characters; leave empty only for legacy agents" />
      {mandateId ? <><Label htmlFor={`${uid}-reference`}>Direct-payment purchase reference hash</Label><Input id={`${uid}-reference`} value={reference} disabled={!!busy} onChange={e => setReference(e.target.value.trim().toLowerCase())} className="font-mono text-xs" /><p className="text-xs text-muted-foreground">Direct Pay requires this hash. x402 uses its reviewed quote ID instead. Repeating the same direct payment reuses its on-chain payment ID. Save this ID before reloading; reconcile unknown outcomes before starting another purchase.</p>{directPaymentId ? <p className="break-all font-mono text-xs">Last direct payment ID: {directPaymentId}</p> : null}<Button size="sm" variant="outline" disabled={disabled || !!busy} onClick={() => { directRequest.current = null; setResponse(null); }}>Start a new direct payment</Button></> : null}
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
          <Input id={`${uid}-url`} value={url} disabled={!!busy} onChange={(e) => { setUrl(e.target.value); setTerms(null); requestId.current = null; setResponse(null); }} spellCheck={false} className="font-mono text-xs" placeholder="https://…" />
          <Button size="sm" variant="outline" disabled={!!busy || !url} onClick={checkTerms}>
            {busy === "terms" ? "Reading…" : "Read terms"}
          </Button>
          <Button size="sm" disabled={disabled || !!busy || !active || !terms || !payeeAllowed} onClick={payUrl}>
            {busy === "x402" ? "Paying…" : "Pay endpoint"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Read and review terms before paying. Repeating Pay checks the same request; Read terms starts a new one. If settlement is unknown, reconcile it before starting another payment.</p>
        {terms ? (
          <div className="font-mono text-xs text-muted-foreground">
            wants {usdc(terms.amount)} → {terms.payTo.slice(0, 6)}…{terms.payTo.slice(-4)} ·{" "}
            {payeeAllowed ? <span className="text-foreground">payee is allowlisted</span> : <span className="text-destructive">payee is NOT on this covenant; the policy will refuse</span>}
            <p className="break-all pt-2">Purchase reference / quote ID: {terms.quoteId}</p>
            {mandateId && onchainPaymentId ? <p className="break-all pt-2">On-chain payment ID: {onchainPaymentId}</p> : null}
          </div>
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
