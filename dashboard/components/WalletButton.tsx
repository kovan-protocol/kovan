"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { connectFreighter } from "@/lib/wallet";
import { shortId } from "@/lib/format";

type Props = { address: string | null; owner: string | null; onConnect: (address: string) => void };

export function WalletButton({ address, owner, onConnect }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      onConnect(await connectFreighter());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (address) {
    const isOwner = owner !== null && owner === address;
    return (
      <div className="flex items-center gap-2">
        <Badge variant={isOwner ? "default" : "secondary"} title={address}>
          {isOwner ? "owner" : "not the pool owner"} · {shortId(address, 4)}
        </Badge>
        <Button variant="ghost" size="sm" onClick={connect} disabled={busy}>
          Switch
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={connect} disabled={busy}>
        {busy ? "Connecting…" : "Connect Freighter"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
