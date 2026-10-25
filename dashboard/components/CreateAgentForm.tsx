"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildCovenantArgs, EMPTY_FORM, type CovenantArgs, type CovenantForm } from "@/lib/covenant-form";

type Props = {
  latestLedger: number;
  disabled?: boolean;
  disabledReason?: string;
  onSubmit: (args: CovenantArgs) => Promise<void>;
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CreateAgentForm({ latestLedger, disabled, disabledReason, onSubmit }: Props) {
  const [f, setF] = useState<CovenantForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const uid = useId();

  async function generateKey() {
    setError(null);
    setGenBusy(true);
    try {
      const r = await fetch("/api/agent/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: `agent-${Date.now()}` }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not generate a key");
      setF((p) => ({ ...p, agentKey: j.publicKey }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenBusy(false);
    }
  }
  const id = (k: string) => `${uid}-${k}`;
  const set = (k: keyof CovenantForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let args: CovenantArgs;
    try {
      args = buildCovenantArgs(f, latestLedger);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(args);
      setF(EMPTY_FORM);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const addCall = () => setF((p) => ({ ...p, calls: [...p.calls, { contract: "", fnName: "", amountArg: "", amountCap: "" }] }));
  const setCall = (i: number, k: keyof CovenantForm["calls"][number], v: string) =>
    setF((p) => ({ ...p, calls: p.calls.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const removeCall = (i: number) => setF((p) => ({ ...p, calls: p.calls.filter((_, j) => j !== i) }));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field id={id("key")} label="Agent public key" hint="Generate one here (kept in this machine's git-ignored keystore, so the console can sign for the agent), or paste a G… address / 64-hex key you made with `stellar keys generate`.">
        <div className="flex gap-2">
          <Input id={id("key")} value={f.agentKey} onChange={set("agentKey")} spellCheck={false} autoComplete="off" className="font-mono" required />
          <Button type="button" variant="outline" disabled={genBusy} onClick={generateKey}>
            {genBusy ? "Generating…" : "Generate"}
          </Button>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("draw")} label="Draw limit (USDC)" hint="Max the agent may move from the pool into its own account.">
          <Input id={id("draw")} inputMode="decimal" value={f.drawLimit} onChange={set("drawLimit")} className="font-mono" required />
        </Field>
        <Field id={id("exp")} label="Expiry (hours from now)" hint="Spending stops at this ledger; returning funds never does.">
          <Input id={id("exp")} inputMode="decimal" value={f.expiryHours} onChange={set("expiryHours")} className="font-mono" required />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Providers</legend>
        <Field id={id("prov")} label="Allowed payees (one per line)" hint="x402 resource servers or any address paid per call.">
          <Textarea id={id("prov")} rows={2} value={f.providers} onChange={set("providers")} spellCheck={false} className="font-mono text-sm" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("ppt")} label="Per-transfer cap (USDC)">
            <Input id={id("ppt")} inputMode="decimal" value={f.providerPerTransfer} onChange={set("providerPerTransfer")} className="font-mono" />
          </Field>
          <Field id={id("pt")} label="Total cap (USDC)">
            <Input id={id("pt")} inputMode="decimal" value={f.providerTotal} onChange={set("providerTotal")} className="font-mono" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Recipients (optional)</legend>
        <Field id={id("rec")} label="Allowed plain transfers (one per line)">
          <Textarea id={id("rec")} rows={2} value={f.recipients} onChange={set("recipients")} spellCheck={false} className="font-mono text-sm" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("rpt")} label="Per-transfer cap (USDC)">
            <Input id={id("rpt")} inputMode="decimal" value={f.recipientPerTransfer} onChange={set("recipientPerTransfer")} className="font-mono" />
          </Field>
          <Field id={id("rt")} label="Total cap (USDC)">
            <Input id={id("rt")} inputMode="decimal" value={f.recipientTotal} onChange={set("recipientTotal")} className="font-mono" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Contract calls (optional)</legend>
        {f.calls.length === 0 ? <p className="text-xs text-muted-foreground">No contract calls allowed beyond USDC and the pool.</p> : null}
        {f.calls.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
            <Input aria-label="Contract" placeholder="C…" value={c.contract} onChange={(e) => setCall(i, "contract", e.target.value)} spellCheck={false} className="font-mono text-xs" />
            <Input aria-label="Function" placeholder="fn" value={c.fnName} onChange={(e) => setCall(i, "fnName", e.target.value)} spellCheck={false} className="font-mono text-xs" />
            <Input aria-label="Amount arg index" placeholder="arg #" inputMode="numeric" value={c.amountArg} onChange={(e) => setCall(i, "amountArg", e.target.value)} className="font-mono text-xs" />
            <Input aria-label="Amount cap" placeholder="cap USDC" inputMode="decimal" value={c.amountCap} onChange={(e) => setCall(i, "amountCap", e.target.value)} className="font-mono text-xs" />
            <Button type="button" variant="ghost" size="sm" onClick={() => removeCall(i)} aria-label="Remove call rule">
              ×
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={addCall}>
            Add call rule
          </Button>
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled || busy}>
          {busy ? "Creating…" : "Create agent"}
        </Button>
        {disabled && disabledReason ? <span className="text-xs text-muted-foreground">{disabledReason}</span> : null}
      </div>
    </form>
  );
}
