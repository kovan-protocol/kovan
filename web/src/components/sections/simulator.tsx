"use client";

import { SplitWords } from "@/components/motion/split-words";
import { DRAW, PER, TOTAL, evaluatePayment, type Payee } from "@/lib/simulator";
import { useRef, useState } from "react";

const TITLES = ["01 · status", "02 · pool", "03 · policy", "04 · policy"];
const LABELS = ["status", "draw limit", "payee", "caps"];

type CheckState = "" | "run" | "pass" | "fail" | "skip";

const presets = {
  ok: { payee: "provider" as Payee, amount: 5, revoked: false, expired: false },
  unlisted: { payee: "unlisted" as Payee, amount: 5, revoked: false, expired: false },
  cap: { payee: "provider" as Payee, amount: 25, revoked: false, expired: false },
  freeze: { payee: "provider" as Payee, amount: 5, revoked: true, expired: false },
};

export function Simulator() {
  const [payee, setPayee] = useState<Payee>("provider");
  const [amount, setAmount] = useState(5);
  const [revoked, setRevoked] = useState(false);
  const [expired, setExpired] = useState(false);
  const [drawn, setDrawn] = useState(0);
  const [spent, setSpent] = useState(0);
  const [preset, setPreset] = useState("ok");
  const [checks, setChecks] = useState<{ state: CheckState; label: string }[]>(
    LABELS.map((label) => ({ state: "", label })),
  );
  const [verdict, setVerdict] = useState({
    tone: "",
    icon: "K",
    title: "Ready.",
    detail: "Choose a scenario or set a payment, then run it.",
  });
  const busy = useRef(false);
  const balances = useRef({ drawn: 0, spent: 0 });

  const status = revoked
    ? { text: "❄ revoked", color: "var(--ice)" }
    : expired
      ? { text: "◌ expired", color: "var(--warn)" }
      : { text: "● active", color: "var(--ok)" };

  const wait = (ms: number) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms);
    });

  const run = async (next?: { payee: Payee; amount: number; revoked: boolean; expired: boolean }) => {
    if (busy.current) return;
    busy.current = true;
    const current = {
      payee: next?.payee ?? payee,
      amount: next?.amount ?? amount,
      revoked: next?.revoked ?? revoked,
      expired: next?.expired ?? expired,
    };
    const value = Math.round(current.amount) / 100;
    setChecks(LABELS.map((label) => ({ state: "", label })));
    setVerdict({
      tone: "",
      icon: "…",
      title: "Checking…",
      detail: "The pool and the covenant policy evaluate the payment.",
    });
    const failure = evaluatePayment({
      amount: value,
      payee: current.payee,
      drawn: balances.current.drawn,
      spent: balances.current.spent,
      revoked: current.revoked,
      expired: current.expired,
    });
    for (let i = 0; i < 4; i++) {
      setChecks((prev) => prev.map((check, index) => (index === i ? { ...check, state: "run" } : check)));
      await wait(380);
      if (failure && failure.index === i) {
        setChecks((prev) =>
          prev.map((check, index) => {
            if (index === i) return { state: "fail", label: `✕ ${failure.short}` };
            if (index > i) return { ...check, state: "skip" };
            return { ...check, state: "pass" };
          }),
        );
        setVerdict({ tone: failure.tone, icon: failure.icon, title: failure.title, detail: failure.detail });
        busy.current = false;
        window.setTimeout(() => {
          setChecks(LABELS.map((label) => ({ state: "", label })));
        }, 2600);
        return;
      }
      setChecks((prev) => prev.map((check, index) => (index === i ? { ...check, state: "pass" } : check)));
    }
    const nextDrawn = balances.current.drawn + value;
    const nextSpent = balances.current.spent + value;
    balances.current = { drawn: nextDrawn, spent: nextSpent };
    setDrawn(nextDrawn);
    setSpent(nextSpent);
    setVerdict({
      tone: "ok",
      icon: "✓",
      title: `Paid ${value.toFixed(2)} USDC to data-provider.`,
      detail: `Inside every limit. ${(TOTAL - nextSpent).toFixed(2)} left before the total cap.`,
    });
    busy.current = false;
  };

  const applyPreset = (key: keyof typeof presets) => {
    const next = presets[key];
    setPreset(key);
    setPayee(next.payee);
    setAmount(next.amount);
    setRevoked(next.revoked);
    setExpired(next.expired);
    void run(next);
  };

  return (
    <section className="sec paper scrub" id="simulator" data-sec="06" data-title="Playground">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="eyebrow" data-reveal>
              <b>§06</b> Playground
            </div>
            <h2 style={{ marginTop: 18 }}>
              <SplitWords text="Let the agent act." />
              <br />
              <SplitWords text="Watch the rules hold." />
            </h2>
          </div>
          <p className="lede" data-reveal>
              Pick a payee and an amount, freeze the agent or let the covenant expire. The same checks the pool
              and policy run on-chain, replayed locally in your browser.
            </p>
        </div>
        <div className="simgrid" data-reveal>
          <div className={revoked ? "cov frozen" : "cov"} id="cov">
            <div className="hd">
              <span>Covenant · monitor</span>
              <span className="cap-sm">Illustrative</span>
            </div>
            <h3>monitor</h3>
            <div className="sub">bound to agent smart account · set by owner</div>
            <dl>
              <div>
                <span className="rn">I</span>
                <dt>
                  Draw limit
                  <div className="meter">
                    <i style={{ width: `${(drawn / DRAW) * 100}%` }} />
                  </div>
                </dt>
                <dd>
                  <span>{drawn.toFixed(2)}</span> / {DRAW.toFixed(2)}
                </dd>
              </div>
              <div>
                <span className="rn">II</span>
                <dt>Allowed payee</dt>
                <dd>data-provider</dd>
              </div>
              <div>
                <span className="rn">III</span>
                <dt>Per-transfer cap</dt>
                <dd>{PER.toFixed(2)}</dd>
              </div>
              <div>
                <span className="rn">IV</span>
                <dt>
                  Total cap to payee
                  <div className="meter">
                    <i style={{ width: `${(spent / TOTAL) * 100}%` }} />
                  </div>
                </dt>
                <dd>
                  <span>{spent.toFixed(2)}</span> / {TOTAL.toFixed(2)}
                </dd>
              </div>
              <div>
                <span className="rn">V</span>
                <dt>Expiry</dt>
                <dd>{expired ? "passed" : "ledger +17,280"}</dd>
              </div>
              <div>
                <span className="rn">VI</span>
                <dt>Status</dt>
                <dd style={{ color: status.color }}>{status.text}</dd>
              </div>
            </dl>
            <div className="foot">The agent can execute inside this covenant. It can&apos;t edit it.</div>
          </div>
          <div className="panel">
            <div className="presets" role="group" aria-label="Scenarios">
              {(
                [
                  ["ok", "Approved payment"],
                  ["unlisted", "Unlisted payee"],
                  ["cap", "Over the cap"],
                  ["freeze", "Owner freeze"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className="preset"
                  type="button"
                  aria-pressed={preset === key}
                  onClick={() => applyPreset(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="fields">
              <label className="field" htmlFor="payee">
                <span className="fl">Recipient</span>
                <select
                  id="payee"
                  value={payee}
                  onChange={(event) => setPayee(event.target.value as Payee)}
                >
                  <option value="provider">data-provider (allowlisted)</option>
                  <option value="unlisted">GDX7…Q2LM (unlisted)</option>
                  <option value="self">the agent&apos;s own wallet (admin call)</option>
                </select>
              </label>
              <div className="field">
                <span className="fl" id="amtl">
                  Amount
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="range"
                    id="amt"
                    min={1}
                    max={60}
                    value={amount}
                    aria-labelledby="amtl"
                    onChange={(event) => setAmount(Number(event.target.value))}
                  />
                  <span className="amt">{(amount / 100).toFixed(2)}</span>
                </div>
              </div>
            </div>
            <div className="toggles">
              <label className="tg">
                <input type="checkbox" checked={revoked} onChange={(event) => setRevoked(event.target.checked)} />
                <span className="sw" />
                Owner revoked
              </label>
              <label className="tg">
                <input type="checkbox" checked={expired} onChange={(event) => setExpired(event.target.checked)} />
                <span className="sw" />
                Covenant expired
              </label>
            </div>
            <div className="run">
              <button className="btn btn-primary" type="button" onClick={() => void run()}>
                Run payment <span className="arr">→</span>
              </button>
              <button
                className="btn btn-light"
                type="button"
                onClick={() => {
                  balances.current = { drawn: 0, spent: 0 };
                  setDrawn(0);
                  setSpent(0);
                  setChecks(LABELS.map((label) => ({ state: "", label })));
                  setVerdict({
                    tone: "",
                    icon: "K",
                    title: "Balances reset.",
                    detail: "Choose a scenario or set a payment, then run it.",
                  });
                }}
              >
                Reset balances
              </button>
            </div>
            <div className="pipe" aria-live="polite">
              {checks.map((check, index) => (
                <div key={TITLES[index]} className={check.state ? `chk ${check.state}` : "chk"}>
                  <div className="t">{TITLES[index]}</div>
                  <div className="s">{check.label}</div>
                </div>
              ))}
            </div>
            <div className={verdict.tone ? `verdict ${verdict.tone}` : "verdict"} aria-live="polite">
              <div className="ic">{verdict.icon}</div>
              <div>
                <b>{verdict.title}</b>
                <span>{verdict.detail}</span>
              </div>
            </div>
            <div className="sim-note">
              Local simulation. No wallet, no chain. Values are illustrative; on testnet these checks run in the
              contracts.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
