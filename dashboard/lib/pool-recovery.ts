import { statusOf, type State } from "./client";
import { shortId, usdc } from "./format";
import type { OwnerArgs } from "./owner";

export type RecoveryMode = "free" | "withdraw";
type RecoveryFn = "revoke" | "return_funds" | "close" | "amend" | "withdraw";
export type RecoveryStep = { [F in RecoveryFn]: { fn: F; args: OwnerArgs[F]; label: string } }[RecoveryFn];

/** Cash and accounting must both permit a withdrawal, including on legacy pools. */
export function withdrawable(state: State): bigint {
  if (state.pool.balance === undefined) return 0n;
  const free = BigInt(state.pool.locked) - BigInt(state.pool.sum_limits);
  const cash = BigInt(state.pool.balance);
  return free <= 0n || cash <= 0n ? 0n : free < cash ? free : cash;
}

function checkGraph(state: State) {
  const agents = new Map(state.agents.map((a) => [a.id, a]));
  if (agents.size !== state.agents.length) throw new Error("Duplicate agents in pool state. Refresh before recovering.");
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("Invalid agent delegation cycle. Recovery stopped.");
    if (visited.has(id)) return;
    const a = agents.get(id);
    if (!a) throw new Error("A child agent is missing from pool state. Refresh before recovering.");
    visiting.add(id);
    for (const child of a.children) visit(child);
    visiting.delete(id);
    visited.add(id);
  }
  for (const a of state.agents) visit(a.id);
}

/** Re-plan after every confirmed transaction. Never rely on pre-recovery balances. */
export function nextRecoveryStep(state: State): RecoveryStep | null {
  checkGraph(state);
  const by = state.pool.owner;
  const open = state.agents.filter((a) => statusOf(a.status) !== "Closed");
  // Freeze every agent before any recovery: an external runtime may still be spending.
  const active = open.find((a) => statusOf(a.status) !== "Revoked");
  if (active) return { fn: "revoke", args: { agent: active.id, by }, label: `Stop agent · ${shortId(active.id)}` };

  const legacy = (state.pool.accounting_version ?? 1) < 2;
  // V2 close recovers atomically. Closed accounts can still receive external deposits.
  const funded = state.agents.find((a) => BigInt(a.balance) > 0n && (legacy || statusOf(a.status) === "Closed"));
  if (funded) return { fn: "return_funds", args: { agent: funded.id, by, amount: funded.balance }, label: `Recover ${usdc(funded.balance)} · ${shortId(funded.id)}` };

  const closable = open.find((a) => (!legacy || BigInt(a.drawn) === 0n) && a.children.every((id) => state.agents.some((c) => c.id === id && statusOf(c.status) === "Closed")));
  if (closable) return { fn: "close", args: { agent: closable.id, by }, label: `Release allocation · ${shortId(closable.id)}` };

  if (legacy) {
    // V1 cannot settle spent advances. Shrink frozen allocations to their outstanding
    // principal instead. A parent blocked by a spent child must retain >= 1 base unit.
    const reducible = open.find((a) => BigInt(a.draw_limit) > (BigInt(a.drawn) > 0n ? BigInt(a.drawn) : 1n));
    if (reducible) {
      const c = reducible.covenant;
      const draw_limit = BigInt(reducible.drawn) > 0n ? reducible.drawn : "1";
      return {
        fn: "amend",
        args: { agent: reducible.id, draw_limit, amendment: {
          provider_per_transfer_cap: c.provider_per_transfer_cap,
          provider_total_cap: c.provider_total_cap,
          recipient_per_transfer_cap: c.recipient_per_transfer_cap,
          recipient_total_cap: c.recipient_total_cap,
          // Policy requires a future expiry even when already revoked. This does NOT un-revoke.
          expiry: Math.max(c.expiry, state.latestLedger + 720),
        } },
        label: `Release unused legacy allocation · ${shortId(reducible.id)}`,
      };
    }
  }
  return null;
}

type RecoveryOptions = {
  mode: RecoveryMode;
  pool: string;
  owner: string;
  read: () => Promise<State>;
  /** Must resolve only after SUCCESS; rejection/unknown transaction status must throw. */
  run: (step: RecoveryStep) => Promise<void>;
};

/** Separate owner-signed transactions, not an atomic batch. Safe to resume after cancellation. */
export async function runPoolRecovery({ mode, pool, owner, read, run }: RecoveryOptions): Promise<{ state: State; transactions: number }> {
  async function checkedRead() {
    const state = await read();
    if (state.ids.pool !== pool || state.pool.owner !== owner) throw new Error("Pool or owner changed. Recovery stopped before the next transaction.");
    if (state.pool.balance === undefined) throw new Error("Pool balance unavailable. Refresh before recovering.");
    return state;
  }
  let state = await checkedRead();
  if (mode === "withdraw") {
    const amount = withdrawable(state);
    if (amount === 0n) throw new Error("No USDC is available to withdraw. Free the pool first if agents still have allocations.");
    await run({ fn: "withdraw", args: { amount: amount.toString() }, label: `Return ${usdc(amount)} to owner wallet` });
    return { state: await checkedRead(), transactions: 1 };
  }

  const approvedAgents = new Set(state.agents.map((a) => a.id));
  const maxSteps = state.agents.length * 4 + 1;
  let transactions = 0;
  let previous = "";
  for (;;) {
    if (state.agents.some((a) => !approvedAgents.has(a.id))) throw new Error("An agent was added during recovery. Review the pool and start again.");
    const step = nextRecoveryStep(state);
    if (!step) return { state, transactions };
    // A refreshed ledger number can change the proposed legacy expiry without
    // advancing the allocation itself. Do not ask the owner to sign it twice.
    const fingerprint = step.fn === "amend"
      ? JSON.stringify([step.fn, step.args.agent, step.args.draw_limit])
      : JSON.stringify(step);
    if (fingerprint === previous || transactions >= maxSteps) throw new Error("Recovery state has not advanced as expected. Refresh and retry; confirmed steps are preserved.");
    await run(step);
    transactions++;
    previous = fingerprint;
    state = await checkedRead();
  }
}
