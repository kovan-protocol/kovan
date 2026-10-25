"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { StateAgent } from "@/lib/client";
import { downloadAgentKey } from "@/lib/wallet";

export function AgentSigner({ agent, owner, pool, isOwner }: { agent: StateAgent; owner: string | null; pool: string; isOwner: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const signing = agent.signing;
  if (!signing) return null;

  async function download() {
    if (!owner || !isOwner || busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await downloadAgentKey(owner, pool, agent.id);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-sm font-medium">{signing.mode === "managed" ? "App-managed signer" : "External signer"}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">{signing.publicKey}</p>
      {signing.mode === "external" ? <p className="text-xs text-muted-foreground">Sign agent actions from the runtime that holds this key. This app has no private key for this signer.</p> : (
        <>
          <p className="text-xs text-muted-foreground">The app stores the signer key and runs agent actions within the covenant.</p>
          {signing.exportable ? <>
            <p className="text-xs text-muted-foreground">Downloading gives you a private-key copy for your runtime. The app keeps its copy and can still sign.</p>
            <div><Button variant="outline" disabled={!isOwner || busy} aria-busy={busy} onClick={download}>{busy ? "Authorize in Freighter…" : "Download signer key"}</Button></div>
            {!isOwner ? <p className="text-xs text-muted-foreground">Connect the pool owner’s wallet to download.</p> : null}
          </> : <p className="text-xs text-muted-foreground">Export is available only for keys generated with a verified owner. This existing key remains usable for agent actions.</p>}
        </>
      )}
      <div aria-live="polite">{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : done ? <p className="text-xs text-muted-foreground">Download requested. Store the file with your runtime’s credentials.</p> : null}</div>
    </div>
  );
}
