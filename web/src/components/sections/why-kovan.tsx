"use client";

import { SplitWords } from "@/components/motion/split-words";
import { BLOCKED_PAYMENT_HASH } from "@/config/site";
import { contractUrl, deployment, firstAgent, shortId, txUrl } from "@/lib/testnet";
import { useState } from "react";

const LOCK = 5;
const EACH = 1.5;
const COLORS = ["#014CFE", "#2F63FF", "#5A86FF", "#86A7FF"];

export function WhyKovan() {
  const [count, setCount] = useState(0);
  const [ghost, setGhost] = useState(false);
  const [poolMsg, setPoolMsg] = useState("Add agents until the pool is full, then try once more.");
  const [poolTone, setPoolTone] = useState("");
  const [shake, setShake] = useState(false);
  const [widen, setWiden] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [childFrozen, setChildFrozen] = useState(false);
  const [nestMsg, setNestMsg] = useState("Illustrative values.");
  const [nestTone, setNestTone] = useState("");

  const assigned = count * EACH;
  const over = ghost;
  const equation = over
    ? `Σ ${((count + 1) * EACH).toFixed(2)} > ${LOCK.toFixed(2)}`
    : `Σ ${assigned.toFixed(2)} ≤ ${LOCK.toFixed(2)}`;

  const addAgent = () => {
    if ((count + 1) * EACH <= LOCK) {
      const next = count + 1;
      setCount(next);
      setGhost(false);
      setPoolTone("ok");
      setPoolMsg(`✓ create_agent ok · Σ limits ${(next * EACH).toFixed(2)} ≤ ${LOCK.toFixed(2)} locked`);
      return;
    }
    setGhost(true);
    setShake(true);
    setPoolTone("deny");
    setPoolMsg(
      `✕ create_agent rejected · Σ limits would be ${((count + 1) * EACH).toFixed(2)} > ${LOCK.toFixed(2)} locked`,
    );
    window.setTimeout(() => setShake(false), 450);
    window.setTimeout(() => setGhost(false), 1600);
  };

  const resetPool = () => {
    setCount(0);
    setGhost(false);
    setPoolTone("");
    setPoolMsg("Add agents until the pool is full, then try once more.");
  };

  const tryWiden = () => {
    if (frozen) return;
    setWiden(true);
    setNestTone("deny");
    setNestMsg("✕ delegate rejected · child 0.60 > parent 0.50");
    window.setTimeout(() => setWiden(false), 1500);
  };

  const revoke = () => {
    setWiden(false);
    setFrozen(true);
    setNestTone("ice");
    setNestMsg("❄ parent revoked · child frozen with it");
    window.setTimeout(() => setChildFrozen(true), 350);
  };

  const resetNest = () => {
    setWiden(false);
    setFrozen(false);
    setChildFrozen(false);
    setNestTone("");
    setNestMsg("Illustrative values.");
  };

  const hash = BLOCKED_PAYMENT_HASH;

  return (
    <section className="sec" id="different" data-sec="04" data-title="Why Kovan" style={{ paddingTop: 40 }}>
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="eyebrow" data-reveal>
              <b>§04</b> Why Kovan
            </div>
            <h2 style={{ marginTop: 18 }}>
              <SplitWords text="More than a spending limit." />
            </h2>
          </div>
          <p className="lede" data-reveal>
              Plenty of agent wallets have a cap. Kovan adds what a cap alone can&apos;t do: one pool for many
              agents that can&apos;t be over-assigned, delegation that can only narrow, and refusals you can
              verify on-chain.
            </p>
        </div>
        <div className="diff">
          <article className="card spot c1" data-reveal>
            <div className="eyebrow">
              <b>A</b> Shared pool
            </div>
            <h3>One pool. Never over-assigned.</h3>
            <p>
              Many agents draw from the same locked USDC.{" "}
              <code className="mono" style={{ color: "#C9D4FF" }}>
                create_agent
              </code>{" "}
              fails if the sum of draw limits would exceed what&apos;s locked.
            </p>
            <div className="mini">
              <div className="mini-row">
                <span>
                  pool · locked <b>5.00</b> USDC
                </span>
                <span>
                  assigned <b>{assigned.toFixed(2)}</b> · free <b>{(LOCK - assigned).toFixed(2)}</b>
                </span>
              </div>
              <div
                className={shake ? "partbar shake" : "partbar"}
                role="img"
                aria-label="Pool allocation bar"
              >
                {Array.from({ length: count }, (_, i) => (
                  <div
                    key={i}
                    className="seg"
                    style={{ width: `${(EACH / LOCK) * 100}%`, background: COLORS[i] }}
                  >
                    agent {i + 1}
                  </div>
                ))}
                {ghost ? (
                  <div className="seg ghost" style={{ width: `${((LOCK - assigned) / LOCK) * 100}%` }}>
                    needs 1.50
                  </div>
                ) : null}
              </div>
              <div className="ctl">
                <button className="chipbtn" type="button" onClick={addAgent}>
                  + create_agent (1.50)
                </button>
                <button className="chipbtn" type="button" onClick={resetPool}>
                  Reset
                </button>
                <span className="tag sim">Simulation · illustrative values</span>
              </div>
              <div className={poolTone ? `msg ${poolTone}` : "msg"} aria-live="polite">
                {poolMsg}
              </div>
              <div className="inv">
                <span className={over ? "big bad" : "big"}>{equation}</span>
                <span className="cap">invariant · checked in create_agent and amend</span>
              </div>
              <div className="agl">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={i < count ? "on" : undefined}>
                    agent {i + 1}
                    <b>{i < count ? EACH.toFixed(2) : "—"}</b>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="card spot c2" data-reveal>
            <div className="eyebrow">
              <b>B</b> Parent → child delegation
            </div>
            <h3>Sub-agents get less, never more.</h3>
            <p>
              An agent can carve a narrower covenant for a child from its own remaining allowance. Revoke the
              parent and the child freezes too.
            </p>
            <div className="mini">
              <div className={`nest${widen ? " widen" : ""}${frozen ? " frozen" : ""}`}>
                <div className="hd">
                  <span>
                    monitor <span style={{ color: "var(--dim)" }}>· parent</span>
                  </span>
                  <span className="state" style={{ color: frozen ? "var(--ice)" : "var(--ok)" }}>
                    {frozen ? "❄ revoked" : "● active"}
                  </span>
                </div>
                <div className="kv">
                  <span>draw_limit</span>
                  <b>0.50</b>
                  <span>payees</span>
                  <b>data-provider</b>
                  <span>per_transfer</span>
                  <b>0.10</b>
                </div>
                <div className="child">
                  <div className="hd">
                    <span>
                      scout <span style={{ color: "var(--dim)" }}>· child</span>
                    </span>
                    <span className="state" style={{ color: childFrozen ? "var(--ice)" : "var(--ok)" }}>
                      {childFrozen ? "❄ frozen" : "● active"}
                    </span>
                  </div>
                  <div className="kv">
                    <span>draw_limit</span>
                    <b>{widen ? "0.60" : "0.25"}</b>
                    <span>per_transfer</span>
                    <b>0.05</b>
                  </div>
                </div>
              </div>
              <div className="ctl">
                <button className="chipbtn danger" type="button" onClick={tryWiden}>
                  Try to widen child
                </button>
                <button className="chipbtn danger" type="button" onClick={revoke}>
                  Revoke parent
                </button>
                <button className="chipbtn" type="button" onClick={resetNest}>
                  Reset
                </button>
              </div>
              <div className={nestTone ? `msg ${nestTone}` : "msg"} aria-live="polite">
                {nestMsg}
              </div>
            </div>
          </article>

          <article className="card spot c3" data-reveal>
            <div className="receipt">
              <div>
                <div className="eyebrow">
                  <b>C</b> A refusal, on the record
                </div>
                <h3 style={{ fontSize: "clamp(26px,3vw,38px)", marginTop: 4 }}>
                  A blocked payment is a transaction you can look up.
                </h3>
                <p style={{ marginTop: 12 }}>
                  When the covenant says no, the transaction fails on Stellar and leaves a public record. No
                  server log to trust: anyone can check the refusal on a public explorer.
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
                  <a className="btn btn-ghost" href={contractUrl(firstAgent)} target="_blank" rel="noopener noreferrer">
                    First agent account ↗
                  </a>
                </div>
              </div>
              <div className="rc" role="group" aria-label="Example blocked payment receipt">
                <div className="rc-h">
                  <span className="tag deny">✕ Rejected</span>
                  <span style={{ color: "var(--dim)", fontSize: 11 }}>RECEIPT · STELLAR TESTNET</span>
                </div>
                <div className="rc-b">
                  <div className="rc-r">
                    <span>operation</span>
                    <span>USDC transfer</span>
                  </div>
                  <div className="rc-r">
                    <span>from</span>
                    <span>agent smart account</span>
                  </div>
                  <div className="rc-r">
                    <span>to</span>
                    <span style={{ color: "var(--deny)" }}>address not in covenant</span>
                  </div>
                  <div className="rc-r">
                    <span>checked by</span>
                    <span>kovan-covenant-policy · {shortId(deployment.policy)}</span>
                  </div>
                  <div className="rc-r">
                    <span>result</span>
                    <span>authorization refused · tx failed</span>
                  </div>
                  <div className="rc-r">
                    <span>tx hash</span>
                    <span style={{ color: "var(--dim)" }}>
                      {hash ? (
                        <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer">
                          {hash.slice(0, 6)}… ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                </div>
                <div className="rc-cap">Example receipt · illustrative</div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
