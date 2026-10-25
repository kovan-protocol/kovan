"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildCovenantArgs, EMPTY_FORM, type CovenantArgs, type CovenantForm } from "@/lib/covenant-form";
import { appendAddress, X402_TESTNET_EXAMPLE } from "@/lib/covenant-examples";
import { generateAgentKey } from "@/lib/wallet";

type Props = {
  latestLedger: number;
  disabled?: boolean;
  disabledReason?: string;
  onSubmit: (args: CovenantArgs) => Promise<void>;
  owner: string | null;
  pool: string | null;
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Options({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="min-w-0 rounded-md bg-muted/40 px-3">
      <summary className="min-h-10 cursor-pointer py-3 text-xs font-medium focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">{title}</summary>
      <div className="flex min-w-0 flex-col gap-2 pb-3 text-xs text-muted-foreground">{children}</div>
    </details>
  );
}

export function CreateAgentForm({ latestLedger, disabled, disabledReason, onSubmit, owner, pool }: Props) {
  const [f, setF] = useState<CovenantForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [keyMode, setKeyMode] = useState<"managed" | "external">("managed");
  const [exampleNotice, setExampleNotice] = useState<string | null>(null);
  const uid = useId();

  async function generateKey() {
    setError(null);
    setGenBusy(true);
    try {
      const publicKey = await newKey();
      setF((p) => ({ ...p, agentKey: publicKey }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenBusy(false);
    }
  }
  const id = (k: string) => `${uid}-${k}`;
  const set = (k: keyof CovenantForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function newKey(): Promise<string> {
    if (!owner || !pool) throw new Error("Connect the pool owner's wallet first");
    return (await generateAgentKey(owner, pool)).publicKey;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || genBusy || disabled) return;
    setError(null);
    setBusy(true);
    try {
      let form = f;
      if (!form.agentKey.trim()) {
        if (keyMode === "external") throw new Error("Enter the public key held by your agent runtime");
        // Validate all user-entered covenant fields before opening Freighter.
        if (!owner || latestLedger <= 0) throw new Error("Connect the owner and wait for the pool to load");
        buildCovenantArgs({ ...form, agentKey: owner }, latestLedger);
        const publicKey = await newKey();
        form = { ...form, agentKey: publicKey };
        setF(form);
      }
      const args: CovenantArgs = buildCovenantArgs(form, latestLedger);
      await onSubmit(args);
      setF(EMPTY_FORM);
      setExampleNotice(null);
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
    <form onSubmit={submit} noValidate aria-busy={busy || genBusy}>
      <fieldset disabled={disabled || busy || genBusy} className="flex min-w-0 flex-col gap-5">
      <fieldset className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Agent signer</legend>
        {([ ["managed", "App-managed", "The app stores the signer key and runs agent actions. You can download a copy after creation."], ["external", "Use my own signer", "Your runtime keeps the private key and signs actions. Register only its public key here."] ] as const).map(([mode, label, hint]) => (
          <label key={mode} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md p-1">
            <input type="radio" name={id("signer-mode")} value={mode} checked={keyMode === mode} onChange={() => { setKeyMode(mode); setF((p) => ({ ...p, agentKey: "" })); setError(null); }} className="mt-1 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            <span className="flex flex-col gap-1"><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      <Field id={id("key")} label="Agent signer public key" hint={keyMode === "managed" ? "Generated automatically on creation, or generate it now. Freighter asks you to authorize key generation." : "G… address or 64 hex characters. Keep the matching private key in your own runtime."}>
        <div className="flex gap-2">
          <Input id={id("key")} aria-describedby={`${id("key")}-hint`} value={f.agentKey} onChange={set("agentKey")} readOnly={keyMode === "managed"} required={keyMode === "external"} spellCheck={false} autoComplete="off" className="font-mono" placeholder={keyMode === "managed" ? "Generated when you create the agent" : "G… or 64 hex characters"} />
          {keyMode === "managed" ? <Button type="button" variant="outline" disabled={genBusy} onClick={generateKey}>
            {genBusy ? "Generating…" : "Generate"}
          </Button> : null}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("draw")} label="Draw limit (USDC)" hint="Example: 0.50. Reserves a pool allocation; it does not fund the wallet. Use Draw from pool after creation.">
          <Input id={id("draw")} aria-describedby={`${id("draw")}-hint`} inputMode="decimal" autoComplete="off" placeholder="0.50" value={f.drawLimit} onChange={set("drawLimit")} className="font-mono" required />
        </Field>
        <Field id={id("exp")} label="Expiry (hours from now)" hint="Examples: 1, 24 or 168 (one week). Converted to an approximate ledger deadline. Covenant expiry does not block returning funds.">
          <Input id={id("exp")} aria-describedby={`${id("exp")}-hint`} inputMode="decimal" autoComplete="off" placeholder="24" value={f.expiryHours} onChange={set("expiryHours")} className="font-mono" required />
        </Field>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Providers</legend>
        <p className="text-xs text-muted-foreground">Allow payments to paid APIs, tool services or other service providers. Leave the list empty to allow none.</p>
        <Field id={id("prov")} label="Allowed payees (one per line)" hint="G… account or C… contract addresses on testnet—not website URLs. For x402, use the payTo address from the payment terms.">
          <Textarea id={id("prov")} aria-describedby={`${id("prov")}-hint`} rows={2} value={f.providers} onChange={set("providers")} spellCheck={false} autoComplete="off" placeholder="G… provider account or C… smart account" className="font-mono text-sm" />
        </Field>
        <Options title="Provider options & example">
          <p>Use one provider, several providers (one address per line), or none. This list controls payment destinations, not which URLs the agent can visit.</p>
          <p>Stellar’s x402 testnet demo payee:</p>
          <code className="break-all text-foreground">{X402_TESTNET_EXAMPLE.payTo}</code>
          <Button type="button" variant="outline" className="min-h-10 self-start" onClick={() => {
            setF((p) => ({ ...p, providers: appendAddress(p.providers, X402_TESTNET_EXAMPLE.payTo) }));
            setExampleNotice("Demo payee added to Providers. Existing addresses and spending caps were kept.");
          }}>Add demo payee</Button>
          <p>After creating and funding the agent, put this URL in Pay an x402 endpoint and read its current terms:</p>
          <a href={X402_TESTNET_EXAMPLE.url} target="_blank" rel="noreferrer" className="break-all underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">{X402_TESTNET_EXAMPLE.url}</a>
        </Options>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("ppt")} label="Per-transfer cap (USDC)" hint="Max for one payment. Example: 0.01. Blank or 0 blocks positive payments; it does not mean unlimited.">
            <Input id={id("ppt")} aria-describedby={`${id("ppt")}-hint`} inputMode="decimal" autoComplete="off" placeholder="0.01" value={f.providerPerTransfer} onChange={set("providerPerTransfer")} className="font-mono" />
          </Field>
          <Field id={id("pt")} label="Total cap (USDC)" hint="Shared across all providers for this agent. Example: 0.50. Cumulative, not daily; new funding does not reset spending.">
            <Input id={id("pt")} aria-describedby={`${id("pt")}-hint`} inputMode="decimal" autoComplete="off" placeholder="0.50" value={f.providerTotal} onChange={set("providerTotal")} className="font-mono" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Recipients (optional)</legend>
        <p className="text-xs text-muted-foreground">Allow ordinary USDC transfers to your wallet, a treasury, a collaborator or another smart account.</p>
        <Field id={id("rec")} label="Allowed plain transfers (one per line)" hint="G… or C… addresses, not names or URLs. Leave empty to allow no recipient payments. Pool recovery is handled separately.">
          <Textarea id={id("rec")} aria-describedby={`${id("rec")}-hint`} rows={2} value={f.recipients} onChange={set("recipients")} spellCheck={false} autoComplete="off" placeholder="G… recipient wallet or C… contract" className="font-mono text-sm" />
        </Field>
        <Options title="Recipient options & example">
          <p>For a simple test, allow the pool owner’s wallet. G… recipients need an authorized trustline for this USDC asset to receive it.</p>
          {owner ? <code className="break-all text-foreground">{owner}</code> : <p>Connect the pool owner’s wallet to use this example.</p>}
          <Button type="button" variant="outline" className="min-h-10 self-start" disabled={!owner} onClick={() => {
            if (!owner) return;
            setF((p) => ({ ...p, recipients: appendAddress(p.recipients, owner) }));
            setExampleNotice("Pool owner added to Recipients. Set positive recipient caps to allow a payment; existing values were kept.");
          }}>Add pool owner</Button>
          <p>Providers and recipients have separate spending totals. If the same address is in both lists, provider caps take precedence.</p>
        </Options>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("rpt")} label="Per-transfer cap (USDC)" hint="Max per recipient payment. Example: 0.10. Blank or 0 blocks positive payments.">
            <Input id={id("rpt")} aria-describedby={`${id("rpt")}-hint`} inputMode="decimal" autoComplete="off" placeholder="0.10" value={f.recipientPerTransfer} onChange={set("recipientPerTransfer")} className="font-mono" />
          </Field>
          <Field id={id("rt")} label="Total cap (USDC)" hint="Shared across all recipients for this agent. Example: 0.50. Cumulative, not per recipient or per day.">
            <Input id={id("rt")} aria-describedby={`${id("rt")}-hint`} inputMode="decimal" autoComplete="off" placeholder="0.50" value={f.recipientTotal} onChange={set("recipientTotal")} className="font-mono" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Contract calls (optional)</legend>
        <p className="text-xs text-muted-foreground">Allow an exact contract + function pair, optionally restricting one numeric argument. These are permissions, not actions executed on creation.</p>
        {f.calls.length === 0 ? <p className="text-xs text-muted-foreground">No additional calls allowed. Built-in USDC transfer and pool rules still apply.</p> : null}
        <Options title="Contract-call options & example">
          <p>Choose no extra calls, allow a function without an amount check, or cap one positive i128 argument. Use a deployed testnet contract and verify its interface.</p>
          <p>Illustration only: if a contract exposes <code className="text-foreground">deposit(from, amount)</code>, use function <code className="text-foreground">deposit</code> and amount argument index <code className="text-foreground">1</code> (indexes start at 0).</p>
          <p>A cap of <code className="text-foreground">0.10</code> is encoded as <code className="text-foreground">1,000,000</code> raw units. That means 0.10 USDC only when the argument uses USDC’s 7-decimal units. Check other contracts’ units.</p>
          <p>This is a per-call argument check, not a cumulative contract-call budget. Other arguments are not restricted by this rule. Nested USDC transfers from this agent still need to satisfy the payment rules.</p>
          <p>These rules do not override the special USDC, pool or agent-account restrictions. Adding a function here does not add a button to execute it; your agent runtime must build the call.</p>
        </Options>
        {f.calls.map((c, i) => (
          <fieldset key={i} className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium">Call rule {i + 1}</legend>
            <Field id={id(`call-${i}-contract`)} label="Contract address" hint="A deployed C… address, not a G… wallet or URL.">
              <Input id={id(`call-${i}-contract`)} aria-describedby={`${id(`call-${i}-contract`)}-hint`} placeholder="C…" value={c.contract} onChange={(e) => setCall(i, "contract", e.target.value)} spellCheck={false} autoComplete="off" className="font-mono text-xs" />
            </Field>
            <Field id={id(`call-${i}-function`)} label="Function name" hint="Exact name from the contract interface, e.g. deposit or claim. No wildcards; one function per rule.">
              <Input id={id(`call-${i}-function`)} aria-describedby={`${id(`call-${i}-function`)}-hint`} placeholder="deposit" value={c.fnName} onChange={(e) => setCall(i, "fnName", e.target.value)} spellCheck={false} autoComplete="off" className="font-mono text-xs" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={id(`call-${i}-index`)} label="Amount argument index (optional)" hint="0 = first argument, 1 = second, etc. Blank means no amount check, even if a cap is entered.">
                <Input id={id(`call-${i}-index`)} aria-describedby={`${id(`call-${i}-index`)}-hint`} placeholder="1" inputMode="numeric" autoComplete="off" value={c.amountArg} onChange={(e) => setCall(i, "amountArg", e.target.value)} className="font-mono text-xs" />
              </Field>
              <Field id={id(`call-${i}-cap`)} label="Argument cap (7-decimal units)" hint="Max per call at the chosen index. Example: 0.10 = 1,000,000 raw units. With an index, blank or 0 blocks the call.">
                <Input id={id(`call-${i}-cap`)} aria-describedby={`${id(`call-${i}-cap`)}-hint`} placeholder="0.10" inputMode="decimal" autoComplete="off" value={c.amountCap} onChange={(e) => setCall(i, "amountCap", e.target.value)} className="font-mono text-xs" />
              </Field>
            </div>
            {!c.amountArg.trim() ? <p className="text-xs text-muted-foreground">No amount check selected. This rule allows the function without restricting its argument values.</p> : null}
            <Button type="button" variant="ghost" className="min-h-10 self-start" onClick={() => removeCall(i)} aria-label={`Remove call rule ${i + 1}`}>Remove rule</Button>
          </fieldset>
        ))}
        <div>
          <Button type="button" variant="outline" className="min-h-10" onClick={addCall}>
            Add call rule
          </Button>
        </div>
      </fieldset>

      {exampleNotice ? <p role="status" className="text-xs text-muted-foreground">{exampleNotice}</p> : null}
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
      </fieldset>
    </form>
  );
}
