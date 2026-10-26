"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, Bot, LayoutGrid, RefreshCw, ShieldCheck } from "lucide-react";
import { ConsoleHeader } from "@/components/ConsoleHeader";
import { AgentActions } from "@/components/AgentActions";
import { AgentCard } from "@/components/AgentCard";
import { AgentSigner } from "@/components/AgentSigner";
import { CreateAgentForm } from "@/components/CreateAgentForm";
import { LogPanel } from "@/components/LogPanel";
import { PoolPanel } from "@/components/PoolPanel";
import { PoolRecovery } from "@/components/PoolRecovery";
import { YieldPanel } from "@/components/YieldPanel";
import { loadPools, PoolSelector, savePool } from "@/components/PoolSelector";
import { WalletButton } from "@/components/WalletButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchState, statusOf, type LogEntry, type State } from "@/lib/client";
import type { CovenantArgs } from "@/lib/covenant-form";
import { unitsFromUsdc, usdc } from "@/lib/format";
import type { OwnerArgs, OwnerFn } from "@/lib/owner";
import { runPoolRecovery, withdrawable, type RecoveryMode } from "@/lib/pool-recovery";
import { runOwnerAction } from "@/lib/wallet";

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [fundAmount, setFundAmount] = useState("1");
  const [withdrawAmount, setWithdrawAmount] = useState("1");
  const [pendingOwner, setPendingOwner] = useState<string | null>(null);
  const ownerInFlight = useRef(false);
  const [pools, setPools] = useState<string[]>([]);
  const [pool, setPool] = useState<string | null>(null);
  const [creatingPool, setCreatingPool] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const st = await fetchState(pool);
      setState(st);
      setError(null);
      // first load: learn the default pool id from the server and merge saved pools
      setPools((prev) => (prev.length ? prev : loadPools(st.ids.pool, st.knownPools)));
      setPool((prev) => prev ?? st.ids.pool);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pool]);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const t = setInterval(refresh, 15_000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [refresh]);

  const isOwner = !!state && !!address && address === state.pool.owner;
  const poolClosed = state?.pool.closed === true;

  function selectPool(id: string) {
    if (ownerInFlight.current) return;
    setState(null);
    setPool(id);
  }

  async function createPool() {
    if (!address || ownerInFlight.current) return;
    setCreatingPool(true);
    const at = Date.now();
    setLog((l) => [{ at, kind: "owner", label: "create_pool", ok: null }, ...l]);
    try {
      const r = await runOwnerAction("create_pool", {}, address, pool);
      const ok = r.status === "SUCCESS";
      const newId = ok && typeof r.returnValue === "string" ? r.returnValue : undefined;
      setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: r.hash, detail: ok ? `new pool ${newId ?? ""}` : r.error } : e)));
      if (newId) {
        savePool(newId);
        setPools((p) => (p.includes(newId) ? p : [...p, newId]));
        selectPool(newId);
      } else if (!ok) {
        setError(r.error ?? "create_pool failed");
      }
    } finally {
      setCreatingPool(false);
    }
  }

  async function submitOwner<F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string, source: string, poolId: string) {
    setPendingOwner(label);
    const at = Date.now();
    setLog((l) => [{ at, kind: "owner", label, ok: null }, ...l]);
    try {
      const r = await runOwnerAction(fn, args, source, poolId);
      const ok = r.status === "SUCCESS";
      setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: r.hash, detail: ok ? undefined : r.error } : e)));
      if (!ok) throw new Error(r.error ?? r.status);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      setLog((l) => l.map((e) => e.at === at ? { ...e, ok: false, detail: message } : e));
      throw err;
    }
  }

  async function owner<F extends OwnerFn>(fn: F, args: OwnerArgs[F], label: string) {
    if (!address || !isOwner || !state) throw new Error("Connect the pool owner's wallet first");
    if (poolClosed && !["withdraw", "return_funds", "release_shares", "redeem_shares"].includes(fn)) throw new Error("This pool is permanently closed. Create a new pool to continue.");
    if (ownerInFlight.current) throw new Error("Wait for the current owner transaction to finish");
    ownerInFlight.current = true;
    try {
      await submitOwner(fn, args, label, address, state.ids.pool);
      await refresh();
    } finally {
      ownerInFlight.current = false;
      setPendingOwner(null);
    }
  }

  async function recoverPool(mode: RecoveryMode): Promise<string> {
    if (!address || !isOwner || !state) throw new Error("Connect the pool owner's wallet first");
    if (ownerInFlight.current || creatingPool) throw new Error("Wait for the current owner transaction to finish");
    const poolId = state.ids.pool;
    const source = address;
    ownerInFlight.current = true;
    setPendingOwner("Checking current pool balances");
    setError(null);
    try {
      const result = await runPoolRecovery({
        mode, pool: poolId, owner: source,
        read: async () => {
          const fresh = await fetchState(poolId);
          if (fresh.ids.pool === poolId) setState(fresh);
          return fresh;
        },
        run: (step) => submitOwner(step.fn, step.args, step.label, source, poolId),
      });
      if (mode === "withdraw") return "Available USDC returned to the original pool owner’s wallet. See the session log for the transaction.";
      if (mode === "close") return "Pool permanently closed. Remaining pool USDC and any supported vault shares returned to its original owner. Shares are returned in kind, not redeemed. This pool cannot be reused; create a new pool to continue.";
      const remaining = result.state.agents.filter((a) => statusOf(a.status) !== "Closed").length;
      return remaining
        ? `Unspent funds recovered and unused limits released. ${remaining} legacy allocation(s) remain revoked, not closed. ${usdc(withdrawable(result.state))} is available via Return to wallet.`
        : `Agents closed and unspent funds recovered. ${usdc(withdrawable(result.state))} is available via Return to wallet.`;
    } finally {
      ownerInFlight.current = false;
      setPendingOwner(null);
    }
  }

  async function createAgent(a: CovenantArgs) {
    const covenant = {
      ...a.covenant,
      provider_per_transfer_cap: a.covenant.provider_per_transfer_cap.toString(),
      provider_total_cap: a.covenant.provider_total_cap.toString(),
      recipient_per_transfer_cap: a.covenant.recipient_per_transfer_cap.toString(),
      recipient_total_cap: a.covenant.recipient_total_cap.toString(),
      calls: a.covenant.calls.map((c) => ({ ...c, amount_cap: c.amount_cap.toString() })),
    };
    await owner("create_agent", { agent_pubkey: a.agent_pubkey, draw_limit: a.draw_limit.toString(), covenant }, `create_agent · limit ${usdc(a.draw_limit)}`);
  }

  async function agentRun(action: "draw" | "pay" | "return", body: { agent: string; amount: string; to?: string }, label: string) {
    if (ownerInFlight.current) throw new Error("Wait for the owner transaction or pool recovery to finish");
    const at = Date.now();
    setLog((l) => [{ at, kind: "agent", label: `${label} (${body.agent.slice(0, 6)})`, ok: null }, ...l]);
    const r = await fetch(`/api/agent/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, pool }) });
    const j = (await r.json()) as { hash?: string; status?: string; error?: string; stage?: string };
    const ok = r.ok && j.status === "SUCCESS";
    setLog((l) => l.map((e) => (e.at === at ? { ...e, ok, hash: j.hash || undefined, detail: ok ? undefined : `${j.stage ? j.stage + ": " : ""}${j.error ?? j.status}` } : e)));
    if (ok) await refresh();
    else throw new Error(j.error ?? j.status ?? "failed");
  }

  async function payX402(agent: string, url: string, label: string, approval: { quoteId: string; requestId: string }) {
    if (ownerInFlight.current) throw new Error("Wait for the owner transaction or pool recovery to finish");
    const at = Date.now();
    setLog((l) => [{ at, kind: "agent", label: `${label} (${agent.slice(0, 6)}) ${url}`, ok: null }, ...l]);
    const r = await fetch("/api/x402", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, url, ...(pool ? { pool } : {}), ...approval }) });
    const j = (await r.json()) as { ok: boolean; paymentStatus?: string; txHash?: string; body?: string; error?: string; stage?: string; terms?: import("@/components/AgentActions").X402Terms };
    setLog((l) => l.map((e) => (e.at === at ? { ...e, ok: !!j.ok, hash: j.txHash, detail: j.ok ? `paid ${j.terms ? usdc(j.terms.amount) : ""}` : `${j.stage ? j.stage + ": " : ""}${j.error ?? "failed"}` } : e)));
    if (j.ok || j.paymentStatus === "confirmed" || j.paymentStatus === "unknown") await refresh();
    return j;
  }

  async function fund(e: React.FormEvent) {
    e.preventDefault();
    try {
      const amount = unitsFromUsdc(fundAmount);
      await owner("fund", { amount: amount.toString() }, `fund · ${usdc(amount)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    try {
      const amount = unitsFromUsdc(withdrawAmount);
      if (!state || amount <= 0n || amount > withdrawable(state)) {
        throw new Error("Amount exceeds funds available to withdraw");
      }
      await owner("withdraw", { amount: amount.toString() }, `withdraw · ${usdc(amount)}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const ownerDisabledReason = !address ? "Connect Freighter to sign as the owner." : !isOwner ? "Connected key is not the pool owner." : undefined;

  return (
    <>
      <ConsoleHeader>
        <WalletButton address={address} owner={state?.pool.owner ?? null} onConnect={setAddress} disabled={!!pendingOwner || creatingPool} />
      </ConsoleHeader>
    <main id="main" tabIndex={-1} className="console-container console-main">
      <div className="console-intro">
        <div>
          <p className="console-eyebrow"><span className="network-dot" aria-hidden="true" /> Stellar testnet · Demo console</p>
          <h1>Your agents. <span>Your rules.</span></h1>
          <p>One shared pool. Clear spending limits. Give your agents room to work, and keep control of every allocation.</p>
        </div>
        <span className="console-mode">Testnet USDC · No real value</span>
      </div>

      <div className="console-toolbar">
        <nav className="console-nav" aria-label="Dashboard sections">
          <a href="#overview"><LayoutGrid size={15} aria-hidden="true" /> Overview</a>
          <a href="#agents"><Bot size={16} aria-hidden="true" /> Agents</a>
          <a href="#activity"><Activity size={15} aria-hidden="true" /> Activity</a>
        </nav>
        <div className="console-tools">
          <PoolSelector pools={pools} current={pool} onSelect={selectPool} onCreate={createPool} canCreate={!!address && !pendingOwner} creating={creatingPool} disabled={!!pendingOwner} />
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <span className="min-w-0 break-words">{error}</span>
          <Button size="sm" variant="outline" onClick={() => { setError(null); refresh(); }}>
            Try again
          </Button>
        </div>
      ) : null}

      <PoolPanel state={state}>
        <div className="pool-transfers">
        <form onSubmit={fund} className="pool-transfer-form">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fund-amount">Lock USDC in the pool</Label>
            <Input id="fund-amount" inputMode="decimal" autoComplete="off" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} disabled={!!pendingOwner || poolClosed} className="font-mono" />
          </div>
          <Button type="submit" disabled={!isOwner || !!pendingOwner || poolClosed}>
            Fund
          </Button>
          {ownerDisabledReason ? <p className="text-xs text-muted-foreground">{ownerDisabledReason}</p> : null}
        </form>
        <form onSubmit={withdraw} className="pool-transfer-form">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="withdraw-amount">Withdraw available USDC</Label>
            <Input id="withdraw-amount" inputMode="decimal" autoComplete="off" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} disabled={!!pendingOwner} className="font-mono" />
          </div>
          <Button type="submit" variant="outline" disabled={!isOwner || !!pendingOwner || !state || withdrawable(state) === 0n}>
            Withdraw
          </Button>
        </form>
        </div>
        {state ? <YieldPanel key={`yield-${state.ids.pool}`} state={state} isOwner={isOwner} busy={!!pendingOwner || creatingPool} onRun={owner} /> : null}
        {state ? <PoolRecovery key={state.ids.pool} state={state} isOwner={isOwner} busy={!!pendingOwner || creatingPool} onRun={recoverPool} /> : null}
        {pendingOwner ? <p role="status" className="text-sm text-muted-foreground">Waiting for wallet approval or confirmation: {pendingOwner}</p> : null}
      </PoolPanel>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section id="agents" aria-labelledby="agents-heading" className="flex min-w-0 flex-col gap-4">
          <div className="console-section-heading">
            <div><h2 id="agents-heading">Your agents</h2><p>Individual wallets. On-chain boundaries.</p></div>
            {state ? <span className="console-count">{state.agents.length} total</span> : null}
          </div>
          {!state ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          ) : state.agents.length === 0 ? (
            <Card>
              <CardContent className="console-empty">
                <span className="empty-icon"><Bot size={22} aria-hidden="true" /></span>
                <h3>{poolClosed ? "No agent history" : "Your first agent starts here"}</h3>
                <p>{poolClosed ? "This pool is closed. Use New pool to start again." : "Choose a signer, set a budget, and decide who your agent can pay."}</p>
                {!poolClosed ? <a href="#create-agent" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-foreground">Set up an agent <ArrowUpRight size={16} aria-hidden="true" /></a> : null}
              </CardContent>
            </Card>
          ) : (
            state.agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                latestLedger={state.latestLedger}
                actions={
                  <>
                  <AgentSigner agent={a} owner={address} pool={state.ids.pool} isOwner={isOwner} />
                  {a.signing?.mode !== "external" ? <AgentActions agent={a} run={agentRun} payX402={payX402} latestLedger={state.latestLedger} disabled={!!pendingOwner} /> : null}
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isOwner || !!pendingOwner || BigInt(a.balance) === 0n}
                      onClick={() => owner("return_funds", { agent: a.id, by: address!, amount: a.balance }, `return_funds · ${usdc(a.balance)} from ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      Return all funds
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!isOwner || !!pendingOwner || statusOf(a.status) === "Revoked" || statusOf(a.status) === "Closed"}
                      onClick={() => owner("revoke", { agent: a.id, by: address! }, `revoke · ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      Revoke
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isOwner || !!pendingOwner || statusOf(a.status) === "Closed" || a.children.some((id) => !state.agents.some((child) => child.id === id && statusOf(child.status) === "Closed")) || ((state.pool.accounting_version ?? 1) < 2 && BigInt(a.drawn) !== 0n)}
                      onClick={() => owner("close", { agent: a.id, by: address! }, `close · ${a.id.slice(0, 6)}`).catch(() => {})}
                    >
                      {(state.pool.accounting_version ?? 1) >= 2 ? "Recover & close" : "Close allocation"}
                    </Button>
                  </div>
                  {statusOf(a.status) !== "Closed" && (state.pool.accounting_version ?? 1) >= 2 ? (
                    <p className="text-xs text-muted-foreground">Recover &amp; close permanently stops this agent, returns its wallet balance, and releases unused allocation. Close any child agents first.</p>
                  ) : null}
                  </>
                }
              />
            ))
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card id="create-agent">
            <CardHeader>
              <div className="mb-2 flex items-center gap-2 text-secondary-foreground"><ShieldCheck size={17} aria-hidden="true" /><span className="console-eyebrow">Define the boundaries</span></div>
              <CardTitle><h2>Create an agent</h2></CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Set the permissions. Let your agent do the rest.</p>
            </CardHeader>
            <CardContent>
              <CreateAgentForm latestLedger={state?.latestLedger ?? 0} disabled={!isOwner || !!pendingOwner || poolClosed} disabledReason={poolClosed ? "This pool is permanently closed. Use New pool to continue." : pendingOwner ? "Wait for the current owner transaction." : ownerDisabledReason} onSubmit={createAgent} owner={isOwner ? address : null} pool={state?.ids.pool ?? null} />
            </CardContent>
          </Card>

          <LogPanel session={log} pool={pool} />
        </aside>
      </div>
      <footer className="console-footer">
        <div><p>Agent autonomy. Human control.</p><p className="mt-1">Stellar testnet demo · Not audited.</p></div>
        <a href="https://kovan-indol.vercel.app">Back to Kovan <ArrowUpRight size={15} className="ml-2" aria-hidden="true" /></a>
      </footer>
    </main>
    </>
  );
}
