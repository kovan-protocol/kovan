"use client";

import { Button } from "@/components/ui/button";
import { shortId } from "@/lib/format";

/** Current and historical deployments plus pools saved by this browser. */
export const POOLS_KEY = "kovan.pools";

export function loadPools(defaultPool: string | null, known: string[] = []): string[] {
  let saved: string[] = [];
  try {
    const value: unknown = typeof window === "undefined" ? [] : JSON.parse(window.localStorage.getItem(POOLS_KEY) ?? "[]");
    if (Array.isArray(value)) saved = value.filter((p): p is string => typeof p === "string" && /^C[A-Z2-7]{55}$/.test(p));
  } catch {
    saved = [];
  }
  const all = [...(defaultPool ? [defaultPool] : []), ...known, ...saved];
  return Array.from(new Set(all));
}

export function savePool(id: string) {
  const cur = loadPools(null);
  if (!cur.includes(id)) window.localStorage.setItem(POOLS_KEY, JSON.stringify([...cur, id]));
}

type Props = { pools: string[]; current: string | null; onSelect: (id: string) => void; onCreate: () => void; canCreate: boolean; creating: boolean; disabled?: boolean };

export function PoolSelector({ pools, current, onSelect, onCreate, canCreate, creating, disabled }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="pool-select" className="text-xs text-muted-foreground">
        Pool
      </label>
      <select
        id="pool-select"
        className="h-8 rounded-md border bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={current ?? ""}
        disabled={disabled || creating}
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
