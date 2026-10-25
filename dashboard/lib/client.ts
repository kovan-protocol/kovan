// Browser-side types and fetchers for the console. Amounts arrive as strings.
export type StateAgent = {
  id: string;
  balance: string;
  draw_limit: string;
  drawn: string;
  status: string | string[];
  parent?: string | null;
  children: string[];
  covenant: {
    providers: string[];
    provider_per_transfer_cap: string;
    provider_total_cap: string;
    recipients: string[];
    recipient_per_transfer_cap: string;
    recipient_total_cap: string;
    calls: { contract: string; fn_name: string; amount_arg?: number | null; amount_cap: string }[];
    expiry: number;
  };
  state: { provider_spent: string; recipient_spent: string; revoked: boolean; rule_id: number } | null;
};

export type State = {
  ids: { pool: string; policy: string; verifier: string; usdc: string; owner: string };
  latestLedger: number;
  pool: { owner: string; usdc: string; locked: string; sum_limits: string; agent_count: number };
  agents: StateAgent[];
};

export async function fetchState(pool?: string | null): Promise<State> {
  const r = await fetch(`/api/state${pool ? `?pool=${pool}` : ""}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as State;
}

export const statusOf = (s: string | string[]) => (Array.isArray(s) ? s[0] : s);

export type LogEntry = {
  at: number;
  kind: "owner" | "agent" | "read";
  label: string;
  ok: boolean | null; // null = pending
  hash?: string;
  detail?: string;
};
