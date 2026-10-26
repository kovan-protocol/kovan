"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { statusOf, type StateAgent } from "@/lib/client";
import { unitsFromUsdc } from "@/lib/format";
import type { OwnerArgs, OwnerFn } from "@/lib/owner";

type Props = {
  agent: StateAgent; pool: string; asset: string; latestLedger: number; isOwner: boolean; busy: boolean;
  onRun: <F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string) => Promise<void>;
};
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

/** Owner signs the grant transaction. The server/agent cannot issue its own grant. */
export function MandatePanel({ agent, pool, asset, latestLedger, isOwner, busy, onRun }: Props) {
  const [id, setId] = useState("");
  const [kind, setKind] = useState<"exact" | "budget">("exact");
  const [intent, setIntent] = useState("");
  const [payee, setPayee] = useState(agent.covenant.providers[0] ?? agent.covenant.recipients[0] ?? "");
  const [amount, setAmount] = useState("0.01");
  const [total, setTotal] = useState("0.5");
  const [reference, setReference] = useState("");
  const [expiry, setExpiry] = useState(String(Math.min(agent.covenant.expiry, latestLedger + 720)));
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const uid = `mandate-${agent.id}`;
  const disabled = busy || running;

  async function act(action: "create" | "revoke" | "read") {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setRunning(true); setError(null); setMessage(null);
    try {
      if (!/^[a-f0-9]{64}$/.test(id) || /^0{64}$/.test(id)) throw new Error("Generate or paste a nonzero 64-character mandate ID first");
      if (action === "read") {
        const r = await fetch(`/api/mandates?${new URLSearchParams({ pool, agent: agent.id, id })}`, { cache: "no-store" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setMessage(data.mandate ? JSON.stringify(data.mandate, null, 2) : "No mandate with this ID exists on this agent.");
      } else if (action === "revoke") {
        await onRun("revoke_mandate", { agent: agent.id, id }, "Revoke mandate");
        setMessage("Mandate revoked on-chain. New payments under it are refused. Already settled payments cannot be undone.");
      } else {
        if (!intent.trim()) throw new Error("Describe what you authorize before signing");
        if (!agent.covenant.providers.includes(payee) && !agent.covenant.recipients.includes(payee)) throw new Error("Choose a payee already allowed by this covenant");
        const amountUnits = unitsFromUsdc(amount).toString();
        const intentHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(intent.trim()))));
        const params: OwnerArgs["create_mandate"]["params"] = {
          id, intent_hash: intentHash, expiry: Number(expiry),
          scope: kind === "exact"
            ? { kind, asset, payee, amount: amountUnits, reference }
            : { kind, payees: [payee], per_payment_cap: amountUnits, total_cap: unitsFromUsdc(total).toString() },
        };
        await onRun("create_mandate", { agent: agent.id, params }, `Approve ${kind} mandate`);
        setMessage("Mandate confirmed on-chain. Copy this ID into the payment section. Keep your intent text privately; only its hash was recorded.");
      }
    } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setRunning(false); }
  }

  return <details className="flex flex-col gap-3 border-t pt-3">
    <summary className="cursor-pointer text-sm font-medium">On-chain mandates · owner approvals</summary>
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-xs text-muted-foreground">Requires the mandate-enabled contracts; legacy agents are not upgraded automatically. New agents need a mandate for outgoing USDC. Recovery remains available without one.</p>
      <Label htmlFor={`${uid}-id`}>Mandate ID (64 hex characters)</Label>
      <div className="flex gap-2">
        <Input id={`${uid}-id`} value={id} disabled={disabled} onChange={e => setId(e.target.value.trim().toLowerCase())} className="font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setId(hex(crypto.getRandomValues(new Uint8Array(32)))); setMessage(null); }}>New ID</Button>
      </div>
      <p className="text-xs text-muted-foreground">Keep the same ID when checking an interrupted approval. Creating another ID grants additional authority.</p>
      <Label htmlFor={`${uid}-kind`}>Approval scope</Label>
      <select id={`${uid}-kind`} value={kind} disabled={disabled} onChange={e => setKind(e.target.value as "exact" | "budget")} className="rounded-md border bg-background p-2 text-sm">
        <option value="exact">One exact payment</option><option value="budget">Autonomous spending budget</option>
      </select>
      <Label htmlFor={`${uid}-intent`}>What are you authorizing?</Label>
      <Textarea id={`${uid}-intent`} value={intent} disabled={disabled} onChange={e => setIntent(e.target.value)} maxLength={4096} placeholder="Describe the approved purchase or spending purpose" />
      <Label htmlFor={`${uid}-payee`}>Allowed payee</Label>
      <Input id={`${uid}-payee`} value={payee} disabled={disabled} onChange={e => setPayee(e.target.value.trim())} className="font-mono text-xs" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5"><Label htmlFor={`${uid}-amount`}>{kind === "exact" ? "Exact amount (USDC)" : "Per-payment cap (USDC)"}</Label><Input id={`${uid}-amount`} value={amount} disabled={disabled} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor={`${uid}-expiry`}>Expiry ledger (exclusive)</Label><Input id={`${uid}-expiry`} value={expiry} disabled={disabled} onChange={e => setExpiry(e.target.value)} inputMode="numeric" /></div>
      </div>
      {kind === "budget" ? <><Label htmlFor={`${uid}-total`}>Total budget (USDC)</Label><Input id={`${uid}-total`} value={total} disabled={disabled} onChange={e => setTotal(e.target.value)} inputMode="decimal" /><p className="text-xs text-muted-foreground">The agent chooses individual purchases within these limits. Existing covenant caps also apply; this does not reserve extra pool funds.</p></> : <><Label htmlFor={`${uid}-reference`}>Purchase reference hash</Label><Input id={`${uid}-reference`} value={reference} disabled={disabled} onChange={e => setReference(e.target.value.trim().toLowerCase())} className="font-mono text-xs" placeholder="For x402: paste the quote ID shown after Read terms" /><p className="text-xs text-muted-foreground">This authorizes this asset, recipient, amount and reference once, even if the agent changes its payment ID.</p></>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || !isOwner || statusOf(agent.status) !== "Active"} onClick={() => act("create")}>Sign mandate approval</Button>
        <Button size="sm" variant="outline" disabled={disabled || !id} onClick={() => act("read")}>Read mandate</Button>
        <Button size="sm" variant="destructive" disabled={disabled || !isOwner || !id} onClick={() => act("revoke")}>Revoke mandate</Button>
      </div>
      <p className="text-xs text-muted-foreground">The chain enforces payment constraints, not the meaning of your intent or the quality of delivered work.</p>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {message ? <pre role="status" className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{message}</pre> : null}
    </div>
  </details>;
}
