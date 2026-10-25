"use client";

import { Button } from "@/components/ui/button";
import { shortId } from "@/lib/format";

/** Pools this browser knows about: the deployed default plus any created here (localStorage). */
export const POOLS_KEY = "kovan.pools";

export function loadPools(defaultPool: string | null): string[] {
  if (typeof window === "undefined") return defaultPool ? [defaultPool] : [];
  let saved: string[] = [];
  try {
    saved = JSON.parse(window.localStorage.getItem(POOLS_KEY) ?? "[]");
  } catch {
    saved = [];
  }
  const all = [...(defaultPool ? [defaultPool] : []), ...saved];
  return Array.from(new Set(all));
}

export function savePool(id: string) {
  const cur = loadPools(null);
  if (!cur.includes(id)) window.localStorage.setItem(POOLS_KEY, JSON.stringify([...cur, id]));
}

type Props = { pools: string[]; current: string | null; onSelect: (id: string) => void; onCreate: () => void; canCreate: boolean; creating: boolean };

export function PoolSelector({ pools, current, onSelect, onCreate, canCreate, creating }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="pool-select" className="text-xs text-muted-foreground">
        Pool
      </label>
      <select
        id="pool-select"
        className="h-8 rounded-md border bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={current ?? ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        {pools.map((p, i) => (
          <option key={p} value={p}>
            {shortId(p, 6)}
            {i === 0 ? " (default)" : ""}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" onClick={onCreate} disabled={!canCreate || creating} title={canCreate ? "Deploy a new pool owned by the connected key" : "Connect Freighter to create a pool"}>
        {creating ? "Deploying…" : "New pool"}
      </Button>
    </div>
  );
}
