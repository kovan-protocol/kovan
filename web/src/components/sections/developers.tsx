"use client";

import { CopyButton } from "@/components/copy-button";
import { CountUp } from "@/components/motion/count-up";
import { Drift } from "@/components/motion/drift";
import { SplitWords } from "@/components/motion/split-words";
import { GITHUB_URL } from "@/config/site";
import {
  deployedAtLabel,
  deployment,
  firstAgent,
  shortHash,
  sorobanContracts,
  testCount,
  txUrl,
  txsByGroup,
  verifiedTransactions,
} from "@/lib/testnet";
import { useState } from "react";

const ids = [
  { name: "kovan-pool", id: deployment.pool },
  { name: "covenant policy", id: deployment.policy },
  { name: "ed25519 verifier", id: deployment.verifier },
  { name: "first agent account", id: firstAgent },
];

export function Developers() {
  const [tab, setTab] = useState<"t1" | "t2" | "t3">("t1");
  const deploy = txsByGroup("deploy");
  const fund = txsByGroup("fund")[0];
  const created = txsByGroup("create_agent")[0];

  return (
    <section className="sec" id="developers" data-sec="08" data-title="Developers" style={{ paddingTop: 40 }}>
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="eyebrow" data-reveal>
              <b>§08</b> Developers
            </div>
            <h2 style={{ marginTop: 18 }}>
              <SplitWords text="Open source." />
              <br />
              <SplitWords text="Check every claim." />
            </h2>
          </div>
          <Drift>
            <p className="lede" data-reveal>
              Rust and Soroban, built on OpenZeppelin <span className="mono" style={{ fontSize: ".9em" }}>stellar-accounts</span>.
              Contract IDs and transactions below are real and live on Stellar testnet.
            </p>
          </Drift>
        </div>
        <div className="stats" data-reveal>
          <div>
            <CountUp value={sorobanContracts.length} />
            <span>Soroban contracts</span>
          </div>
          <div>
            <CountUp value={testCount} />
            <span>tests in the repo</span>
          </div>
          <div>
            <CountUp value={verifiedTransactions.length} />
            <span>verified testnet transactions</span>
          </div>
          <div>
            <b>OSS</b>
            <span>open source on GitHub</span>
          </div>
        </div>
        <div className="dev">
          <div className="code" data-reveal>
            <div className="tabs" role="tablist" aria-label="Code samples">
              {(
                [
                  ["t1", "covenant.rs"],
                  ["t2", "testnet.sh"],
                  ["t3", "x402 flow"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className="tab"
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <pre hidden={tab !== "t1"}>
              <span className="cm">{"// Sketch of the covenant shape. See the repo for the exact types."}</span>
              {"\n"}
              <span className="kw">pub struct</span> <span className="fn">Covenant</span> {"{\n"}
              {"    draw_limit:   "}
              <span className="kw">i128</span>
              {",            "}
              <span className="cm">{"// carved from the pool"}</span>
              {"\n    providers:    Vec<"}
              <span className="fn">Payee</span>
              {">,      "}
              <span className="cm">{"// x402 providers"}</span>
              {"\n    recipients:   Vec<"}
              <span className="fn">Payee</span>
              {">,      "}
              <span className="cm">{"// direct transfers"}</span>
              {"\n    calls:        Vec<"}
              <span className="fn">AllowedCall</span>
              {">,\n    expiry:       "}
              <span className="kw">u32</span>
              {",             "}
              <span className="cm">{"// ledger sequence"}</span>
              {"\n}\n\n"}
              <span className="kw">pub struct</span> <span className="fn">Payee</span> {"{\n"}
              {"    address:          Address,\n    per_transfer_cap: "}
              <span className="kw">i128</span>
              {",\n    total_cap:        "}
              <span className="kw">i128</span>
              {",\n}\n\n"}
              <span className="cm">{"// Owner: fund · create_agent · amend · revoke · close · withdraw"}</span>
              {"\n"}
              <span className="cm">{"// Agent: draw · return_funds · settle · dispute · delegate"}</span>
            </pre>
            <pre hidden={tab !== "t2"}>
              <span className="cm">{"# Build and run the test suite (from the README)"}</span>
              {"\nrustup target add wasm32v1-none\nmake test                     "}
              <span className="cm">{"# builds wasm, runs the tests"}</span>
              {"\n\n"}
              <span className="cm">{"# Deployed contracts (deployments/testnet.json)"}</span>
              {"\nPOOL="}
              <span className="st">{deployment.pool}</span>
              {"\nPOLICY="}
              <span className="st">{deployment.policy}</span>
              {"\n\n"}
              <span className="cm">{"# Inspect the pool on testnet"}</span>
              {"\nstellar contract info interface \\\n  --id "}
              <span className="st">$POOL</span>
              {" --network testnet"}
            </pre>
            <pre hidden={tab !== "t3"}>
              <span className="cm">{"// Paid call from an agent wallet (agent runtime)"}</span>
              {"\n"}
              <span className="nu">1</span>
              {"  agent  → provider   GET /feed\n"}
              <span className="nu">2</span>
              {"  provider → agent    "}
              <span className="st">402 Payment Required</span>
              {"\n"}
              <span className="nu">3</span>
              {"  runtime              simulate USDC transfer,\n                       sign a fresh auth entry\n"}
              <span className="nu">4</span>
              {"  facilitator          verify + settle on Stellar\n"}
              <span className="nu">5</span>
              {"  USDC contract        asks the agent wallet to authorize\n"}
              <span className="nu">6</span>
              {"  agent wallet         asks the covenant policy\n"}
              <span className="nu">7</span>
              {"  policy               "}
              <span className="kw">allow</span>
              {" if payee + caps + expiry ok\n                       "}
              <span style={{ color: "var(--deny)" }}>deny</span>
              {" otherwise → tx fails\n\n"}
              <span className="cm">{"// Contract-account settlement follows the x402 Stellar spec."}</span>
            </pre>
            <div className="cf">
              <span>Simplified sketch · see the repo for the source</span>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue-t)" }}>
                Open repo ↗
              </a>
            </div>
          </div>
          <div data-reveal>
            <div className="ledger">
              <div className="ledger-h">
                <div>
                  <b>Live on Stellar testnet</b>
                  <small>Last deployment · {deployedAtLabel}</small>
                </div>
                <span className="status">
                  <span className="dot" />
                  Deployed
                </span>
              </div>
              <div className="lrow">
                <span className="st" />
                <span className="what">
                  deploy verifier, policy, pool<small>second deployment, after review fixes</small>
                </span>
                <span>
                  {deploy.map((tx) => (
                    <a key={tx.hash} href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer">
                      {shortHash(tx.hash)}
                    </a>
                  ))}
                </span>
              </div>
              {fund ? (
                <div className="lrow">
                  <span className="st" />
                  <span className="what">
                    fund<small>owner locks 5 testnet USDC</small>
                  </span>
                  <a href={txUrl(fund.hash)} target="_blank" rel="noopener noreferrer">
                    {shortHash(fund.hash)} ↗
                  </a>
                </div>
              ) : null}
              {created ? (
                <div className="lrow">
                  <span className="st" />
                  <span className="what">
                    create_agent<small>frozen agent account, $0.50 draw limit</small>
                  </span>
                  <a href={txUrl(created.hash)} target="_blank" rel="noopener noreferrer">
                    {shortHash(created.hash)} ↗
                  </a>
                </div>
              ) : null}
            </div>
            <div className="ids">
              {ids.map((item) => (
                <div className="idc" key={item.name}>
                  <div style={{ minWidth: 0 }}>
                    <div className="k">{item.name}</div>
                    <div className="v">{item.id}</div>
                  </div>
                  <CopyButton value={item.id} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
