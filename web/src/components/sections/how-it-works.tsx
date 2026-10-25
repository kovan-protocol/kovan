"use client";

import { Drift } from "@/components/motion/drift";
import { SplitWords } from "@/components/motion/split-words";
import { howSvg } from "@/components/sections/howSvg";
import { useEffect } from "react";

const names = ["", "01 · configure", "02 · spend", "03 · reject"];

export function HowItWorks() {
  useEffect(() => {
    const steps = [...document.querySelectorAll<HTMLElement>(".how-steps .step")];
    const svg = document.getElementById("howsvg");
    const label = document.getElementById("howlbl");
    const set = (n: number) => {
      if (svg) svg.dataset.step = String(n);
      if (label) label.textContent = names[n] ?? "";
      steps.forEach((step) => step.classList.toggle("on", step.dataset.step === String(n)));
    };
    const ob = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const step = entry.target instanceof HTMLElement ? Number(entry.target.dataset.step) : 1;
          set(step);
        });
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    steps.forEach((step) => ob.observe(step));
    return () => ob.disconnect();
  }, []);

  return (
    <section className="sec" id="how" data-sec="03" data-title="How it works" style={{ paddingTop: 60 }}>
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="eyebrow" data-reveal>
              <b>§03</b> How it works
            </div>
            <h2 style={{ marginTop: 18 }}>
              <SplitWords text="Three moves." />
              <br />
              <SplitWords text="One of them is a" />{" "}
              <span style={{ color: "var(--deny)" }}>
                <SplitWords text="no" />
              </span>
              .
            </h2>
          </div>
          <Drift>
            <p className="lede" data-reveal>
              Four Soroban contracts: a pool, a per-agent OpenZeppelin smart account, a covenant policy and a
              signature verifier. The owner sets the rules once; every payment is checked against them by the
              network.
            </p>
          </Drift>
        </div>
        <div className="how-grid">
          <div className="how-stage" aria-hidden>
            <div className="bar">
              <span>kovan / architecture</span>
              <span id="howlbl">01 · configure</span>
            </div>
            <div className="diagram-slot" dangerouslySetInnerHTML={{ __html: howSvg }} />
          </div>
          <div className="how-steps">
            <article className="step on" data-step="1">
              <span className="n">01 / OWNER CONFIGURES</span>
              <h3>Lock USDC once. Write each agent&apos;s covenant.</h3>
              <p>
                The owner funds one <code>kovan-pool</code> and calls <code>create_agent</code>. The pool
                deploys a fresh OpenZeppelin smart account for that agent, frozen at creation with the covenant
                as its only rule.
              </p>
              <ul>
                <li>Draw limit carved from the pool, never more than what&apos;s locked</li>
                <li>Allowed payees, with a per-transfer cap and a total cap</li>
                <li>Allowed contract calls and an expiry ledger</li>
              </ul>
            </article>
            <article className="step" data-step="2">
              <span className="n">02 / AGENT SPENDS</span>
              <h3>The agent draws and pays, per call.</h3>
              <p>
                The agent pulls up to its draw limit into its own wallet and pays an allowlisted provider over
                x402. Every outgoing transfer is authorized by the wallet, and the wallet asks the covenant
                policy first.
              </p>
              <ul>
                <li>
                  <code>draw</code> moves only the agent&apos;s share out of the pool
                </li>
                <li>Per-call USDC payments to providers on the list</li>
                <li>
                  <code>return_funds</code> sends unspent USDC back to the pool
                </li>
              </ul>
            </article>
            <article className="step" data-step="3">
              <span className="n">03 / NETWORK REJECTS</span>
              <h3>Anything outside the covenant simply fails.</h3>
              <p>
                A new address, an amount over the cap, an expired covenant, a revoked agent: the policy refuses
                to authorize and the transaction fails on Stellar. No server to trust, no prompt to obey.
              </p>
              <ul>
                <li>The agent can&apos;t call admin functions on its own wallet</li>
                <li>
                  The owner can <code>revoke</code> any agent at any time
                </li>
                <li>Revoking a parent freezes its children</li>
              </ul>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
