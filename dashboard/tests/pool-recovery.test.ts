import { describe, expect, it } from "vitest";
import { nextRecoveryStep, runPoolRecovery, withdrawable, type RecoveryStep } from "../lib/pool-recovery";
import { statusOf, type State, type StateAgent } from "../lib/client";

function agent(id = "agent", overrides: Partial<StateAgent> = {}): StateAgent {
  return { id, status: ["Active"], balance: "4900000", drawn: "5000000", draw_limit: "5000000", children: [],
    covenant: { providers: ["payee"], recipients: [], calls: [], provider_per_transfer_cap: "2000000", provider_total_cap: "5000000", recipient_per_transfer_cap: "0", recipient_total_cap: "0", expiry: 10000 },
    state: { provider_spent: "100000", recipient_spent: "0", revoked: false, rule_id: 0 }, ...overrides };
}

function fixture(legacy = false): State {
  return { ids: { pool: "pool", owner: "owner", usdc: "usdc", policy: "policy", verifier: "verifier" }, latestLedger: 100,
    pool: { owner: "owner", usdc: "usdc", balance: "95000000", locked: "100000000", sum_limits: "5000000", agent_count: 1, ...(legacy ? {} : { accounting_version: 2 }) },
    agents: [agent()] };
}

// Models the existing on-chain entrypoints, including V1's spent-advance limitation.
function harness(initial = fixture()) {
  const state = structuredClone(initial);
  const calls: RecoveryStep[] = [];
  const add = (a: string | undefined, b: bigint) => (BigInt(a ?? "0") + b).toString();
  async function run(step: RecoveryStep) {
    calls.push(step);
    if (step.fn === "close_pool") {
      expect(state.pool.closed).toBe(false);
      expect(state.agents.every((a) => statusOf(a.status) === "Closed")).toBe(true);
      expect(state.pool.sum_limits).toBe("0");
      state.pool.closed = true;
      state.pool.balance = "0";
      state.pool.locked = "0";
      return;
    }
    if (step.fn === "withdraw") {
      expect(BigInt(step.args.amount)).toBeLessThanOrEqual(withdrawable(state));
      state.pool.balance = add(state.pool.balance, -BigInt(step.args.amount));
      state.pool.locked = add(state.pool.locked, -BigInt(step.args.amount));
      return;
    }
    const a = state.agents.find((a) => a.id === step.args.agent)!;
    if (step.fn === "revoke") {
      a.status = ["Revoked"];
      if (a.state) a.state.revoked = true;
    }
    if (step.fn === "return_funds") {
      const amount = BigInt(step.args.amount);
      const principal = amount < BigInt(a.drawn) ? amount : BigInt(a.drawn);
      a.balance = add(a.balance, -amount);
      a.drawn = add(a.drawn, -principal);
      state.pool.balance = add(state.pool.balance, amount);
      if (state.pool.accounting_version === 2) state.pool.locked = add(state.pool.locked, amount - principal);
    }
    if (step.fn === "amend") {
      expect(statusOf(a.status)).toBe("Revoked");
      expect(BigInt(step.args.draw_limit)).toBeGreaterThanOrEqual(BigInt(a.drawn));
      expect(BigInt(step.args.draw_limit)).toBeGreaterThan(0n);
      state.pool.sum_limits = add(state.pool.sum_limits, BigInt(step.args.draw_limit) - BigInt(a.draw_limit));
      a.draw_limit = step.args.draw_limit;
      a.covenant = { ...a.covenant, ...step.args.amendment } as StateAgent["covenant"];
    }
    if (step.fn === "close") {
      expect(a.children.every((id) => statusOf(state.agents.find((c) => c.id === id)!.status) === "Closed")).toBe(true);
      let consumed = 0n;
      if (state.pool.accounting_version === 2) {
        consumed = BigInt(a.drawn) > BigInt(a.balance) ? BigInt(a.drawn) - BigInt(a.balance) : 0n;
        state.pool.locked = add(state.pool.locked, BigInt(a.balance) - BigInt(a.drawn));
        state.pool.balance = add(state.pool.balance, BigInt(a.balance));
        a.balance = "0";
        a.drawn = "0";
      } else expect(a.drawn).toBe("0");
      if (a.parent) {
        const parent = state.agents.find((p) => p.id === a.parent)!;
        parent.draw_limit = add(parent.draw_limit, BigInt(a.draw_limit) - consumed);
        state.pool.sum_limits = add(state.pool.sum_limits, -consumed);
      } else state.pool.sum_limits = add(state.pool.sum_limits, -BigInt(a.draw_limit));
      a.status = ["Closed"];
    }
  }
  const read = async () => structuredClone(state);
  const recover = () => runPoolRecovery({ mode: "recover", pool: "pool", owner: "owner", read, run });
  const withdraw = () => runPoolRecovery({ mode: "withdraw", pool: "pool", owner: "owner", read, run });
  const close = () => runPoolRecovery({ mode: "close", pool: "pool", owner: "owner", read, run });
  return { state, calls, run, read, recover, withdraw, close };
}

describe("permanent pool closure", () => {
  function closable() {
    const s = fixture();
    s.pool.closed = false;
    return s;
  }

  it("recovers agents then permanently closes and refunds the pool", async () => {
    const h = harness(closable());
    await h.close();
    expect(h.calls.map((s) => s.fn)).toEqual(["revoke", "close", "close_pool"]);
    expect(h.calls.at(-1)?.label).toContain("9.99 USDC");
    expect(h.state.pool).toMatchObject({ closed: true, balance: "0", sum_limits: "0" });
    expect((await h.close()).transactions).toBe(0);
  });

  it.each([true, false])("refuses unsupported deployments before any signature (legacy=%s)", async (legacy) => {
    const h = harness(fixture(legacy));
    await expect(h.close()).rejects.toThrow("cannot be permanently closed");
    expect(h.calls).toEqual([]);
  });

  it("closes an empty pool even with no agents or funds", async () => {
    const s = closable();
    s.agents = [];
    Object.assign(s.pool, { locked: "0", sum_limits: "0", balance: "0", agent_count: 0 });
    const h = harness(s);
    await h.close();
    expect(h.calls.map((s) => s.fn)).toEqual(["close_pool"]);
    expect(h.state.pool.closed).toBe(true);
  });

  it("does not claim closure when the final signature is rejected; retries only closure", async () => {
    const h = harness(closable());
    await expect(runPoolRecovery({ mode: "close", pool: "pool", owner: "owner", read: h.read,
      run: async (s) => { if (s.fn === "close_pool") throw new Error("Signing cancelled"); await h.run(s); },
    })).rejects.toThrow("Signing cancelled");
    expect(h.state.pool.closed).toBe(false);
    expect(h.state.pool.balance).toBe("99900000");
    await h.close();
    expect(h.calls.map((s) => s.fn)).toEqual(["revoke", "close", "close_pool"]);
  });

  it("requires a confirmed closed state and never repeats the shutdown on stale reads", async () => {
    const s = closable();
    s.agents = [];
    Object.assign(s.pool, { locked: "0", sum_limits: "0", balance: "0" });
    const h = harness(s);
    await expect(runPoolRecovery({ mode: "close", pool: "pool", owner: "owner", read: h.read,
      run: async (s) => { h.calls.push(s); },
    })).rejects.toThrow("not advanced");
    expect(h.calls).toHaveLength(1);
  });

  it("refuses shutdown with inconsistent outstanding accounting", async () => {
    const s = closable();
    s.agents = [];
    s.pool.sum_limits = "0";
    const h = harness(s);
    await expect(h.close()).rejects.toThrow("outstanding advances");
    expect(h.calls).toEqual([]);
  });

  it("recovers late refunds without reopening a closed pool", async () => {
    const h = harness(closable());
    await h.close();
    h.state.agents[0].balance = "5000";
    await h.recover();
    await h.withdraw();
    expect(h.state.pool.closed).toBe(true);
    expect(h.state.pool.balance).toBe("0");
    expect(h.calls.slice(-2).map((s) => s.fn)).toEqual(["return_funds", "withdraw"]);
  });
});

describe("pool recovery", () => {
  it("recovers V2 spending, closes the allocation, then withdraws exactly 9.99 USDC", async () => {
    const h = harness();
    await h.recover();
    expect(h.calls.map((s) => s.fn)).toEqual(["revoke", "close"]);
    expect(h.state.pool.sum_limits).toBe("0");
    expect(withdrawable(h.state)).toBe(99900000n);
    await h.withdraw();
    expect(h.calls.at(-1)).toMatchObject({ fn: "withdraw", args: { amount: "99900000" } });
    expect(h.state.pool.balance).toBe("0");
  });

  it("frees the deployed legacy scenario without claiming the spent agent is closed", async () => {
    const h = harness(fixture(true));
    await h.recover();
    expect(h.calls.map((s) => s.fn)).toEqual(["revoke", "return_funds", "amend"]);
    expect(h.state.agents[0]).toMatchObject({ drawn: "100000", draw_limit: "100000", status: ["Revoked"], balance: "0" });
    expect(withdrawable(h.state)).toBe(99900000n);
    await h.withdraw();
    expect(h.state.pool.balance).toBe("0");
    expect(h.state.pool.sum_limits).toBe("100000");
    expect((await h.recover()).transactions).toBe(0);
  });

  it("closes legacy agents which have returned all their principal", async () => {
    const s = fixture(true);
    s.agents[0].balance = "5000000";
    const h = harness(s);
    await h.recover();
    expect(h.calls.map((s) => s.fn)).toEqual(["revoke", "return_funds", "close"]);
    expect(withdrawable(h.state)).toBe(100000000n);
  });

  it("closes children before parents and re-reads restored parent limits", async () => {
    const s = fixture();
    s.agents = [agent("parent", { draw_limit: "0", drawn: "0", balance: "0", children: ["child"] }), agent("child", { parent: "parent" })];
    const h = harness(s);
    await h.recover();
    expect(h.calls.filter((s) => s.fn === "close").map((s) => s.args.agent)).toEqual(["child", "parent"]);
    expect(h.state.pool.sum_limits).toBe("0");
    expect(withdrawable(h.state)).toBe(99900000n);
  });

  it("freezes all agents before recovering any funds", async () => {
    const s = fixture(true);
    s.agents.push(agent("second", { drawn: "0", balance: "0" }));
    s.pool.sum_limits = "10000000";
    const h = harness(s);
    await h.recover();
    expect(h.calls.slice(0, 2).map((s) => s.fn)).toEqual(["revoke", "revoke"]);
  });

  it("can recover deposits on an already closed account", async () => {
    const s = fixture();
    s.agents[0] = agent("agent", { status: "Closed", drawn: "0", balance: "5000" });
    s.pool.sum_limits = "0";
    s.pool.locked = s.pool.balance!;
    const h = harness(s);
    await h.recover();
    expect(h.calls.map((s) => s.fn)).toEqual(["return_funds"]);
    expect(h.state.pool.locked).toBe("95005000");
  });

  it("keeps legacy blocked parents at the smallest positive allocation", async () => {
    const s = fixture(true);
    s.pool.sum_limits = "10000000";
    s.agents = [agent("parent", { drawn: "0", balance: "0", children: ["child"] }), agent("child", { parent: "parent" })];
    const h = harness(s);
    await h.recover();
    expect(h.state.agents[0].draw_limit).toBe("1");
    expect(h.state.pool.sum_limits).toBe("100001");
    expect(h.state.agents.every((a) => statusOf(a.status) === "Revoked")).toBe(true);
  });

  it("handles expired legacy covenants without re-enabling them", async () => {
    const s = fixture(true);
    s.agents[0].covenant.expiry = 50;
    const h = harness(s);
    await h.recover();
    expect(h.state.agents[0].covenant.expiry).toBeGreaterThan(s.latestLedger);
    expect(h.state.agents[0].state?.revoked).toBe(true);
    expect(h.state.agents[0].covenant.provider_total_cap).toBe("5000000");
  });

  it("withdraws available funds without touching active agents", async () => {
    const h = harness();
    await h.withdraw();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ fn: "withdraw", args: { amount: "95000000" } });
    expect(h.state.agents[0].status).toEqual(["Active"]);
  });

  it("stops on rejected signatures and can resume confirmed steps", async () => {
    const h = harness(fixture(true));
    await expect(runPoolRecovery({ mode: "recover", pool: "pool", owner: "owner", read: h.read,
      run: async (step) => { if (step.fn === "return_funds") throw new Error("Signing cancelled"); await h.run(step); },
    })).rejects.toThrow("Signing cancelled");
    expect(h.calls.map((s) => s.fn)).toEqual(["revoke"]);
    await h.recover();
    expect(h.calls.map((s) => s.fn)).toEqual(["revoke", "return_funds", "amend"]);
  });

  it.each(["owner", "pool"])("rejects an unexpected %s before signing", async (field) => {
    const h = harness();
    if (field === "owner") h.state.pool.owner = "stranger";
    else h.state.ids.pool = "another pool";
    await expect(h.recover()).rejects.toThrow("Pool or owner changed");
    expect(h.calls).toEqual([]);
  });

  it("rechecks the pool identity between steps", async () => {
    const h = harness();
    await expect(runPoolRecovery({ mode: "recover", pool: "pool", owner: "owner", read: h.read,
      run: async (step) => { await h.run(step); h.state.pool.owner = "stranger"; },
    })).rejects.toThrow("Pool or owner changed");
    expect(h.calls).toHaveLength(1);
  });

  it("does not silently act on newly created agents", async () => {
    const h = harness();
    await expect(runPoolRecovery({ mode: "recover", pool: "pool", owner: "owner", read: h.read,
      run: async (step) => { await h.run(step); h.state.agents.push(agent("new")); },
    })).rejects.toThrow("An agent was added");
    expect(h.calls).toHaveLength(1);
  });

  it("does not resend the same transaction when state reads are stale", async () => {
    const h = harness();
    await expect(runPoolRecovery({ mode: "recover", pool: "pool", owner: "owner", read: h.read, run: async (step) => { h.calls.push(step); } })).rejects.toThrow("not advanced");
    expect(h.calls).toHaveLength(1);
  });

  it("stops after an unknown state-read failure instead of using cached balances", async () => {
    const h = harness();
    await expect(runPoolRecovery({ mode: "recover", pool: "pool", owner: "owner", run: h.run,
      read: async () => { if (h.calls.length) throw new Error("RPC unavailable"); return h.read(); },
    })).rejects.toThrow("RPC unavailable");
    expect(h.calls).toHaveLength(1);
  });

  it("does not repeat a legacy amendment when only the latest ledger advances", async () => {
    const s = fixture(true);
    s.agents[0] = agent("agent", { status: ["Revoked"], balance: "0", drawn: "100000" });
    s.agents[0].covenant.expiry = 50;
    const h = harness(s);
    await expect(runPoolRecovery({ mode: "recover", pool: "pool", owner: "owner", read: h.read,
      run: async (step) => { h.calls.push(step); h.state.latestLedger++; },
    })).rejects.toThrow("not advanced");
    expect(h.calls).toHaveLength(1);
  });

  it("rejects missing child records and delegation cycles before any mutation", () => {
    const s = fixture();
    s.agents[0].children = ["missing"];
    expect(() => nextRecoveryStep(s)).toThrow("missing");
    s.agents[0].children = [s.agents[0].id];
    expect(() => nextRecoveryStep(s)).toThrow("cycle");
  });

  it("does nothing on an empty pool and refuses zero withdrawals", async () => {
    const s = fixture();
    s.agents = [];
    s.pool.balance = "0";
    s.pool.sum_limits = "0";
    const h = harness(s);
    expect((await h.recover()).transactions).toBe(0);
    await expect(h.withdraw()).rejects.toThrow("No USDC");
    expect(h.calls).toEqual([]);
  });

  it("fails closed if the actual pool balance is missing", async () => {
    const h = harness();
    delete h.state.pool.balance;
    expect(withdrawable(h.state)).toBe(0n);
    await expect(h.recover()).rejects.toThrow("balance unavailable");
    await expect(h.withdraw()).rejects.toThrow("balance unavailable");
    expect(h.calls).toEqual([]);
  });

  it("caps withdrawals by both ledger accounting and actual token balance", () => {
    const s = fixture(true);
    s.pool.balance = "100";
    expect(withdrawable(s)).toBe(100n);
    s.pool.sum_limits = "100000001";
    expect(withdrawable(s)).toBe(0n);
  });
});
