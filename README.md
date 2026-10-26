# Kovan

Shared USDC budgets your AI agents can't overspend.
> **Testnet only.** Hackathon prototype on Stellar testnet. Testnet USDC has no value. Not audited. Not a financial product. Not legal advice.

HackMeridian 2026 · Lisbon · Track: Genesis + Stellar Composed ("Agents that spend")

Design: [docs/superpowers/specs/2026-10-25-kovan-covenant-design.md](docs/superpowers/specs/2026-10-25-kovan-covenant-design.md) · Plan: [docs/superpowers/plans/2026-10-25-kovan-contracts.md](docs/superpowers/plans/2026-10-25-kovan-contracts.md)

## One-liner

**Kovan gives AI agents their own on-chain spending covenant.** An owner locks USDC in a pool; each agent gets a smart account that enforces its approved recipients, contract calls, spending caps, and expiry. Signers and allowlists are fixed at creation; the owner can amend numeric limits and expiry. The covenant enforces the same rules for direct and x402 payments.

## Problem

Agents that spend need money to spend. Today you hand the agent a funded wallet and hope, or refill it by hand. A buggy, looping or prompt-injected agent can empty whatever it holds.

## User

A developer running an agent that pays data or RPC providers per call over x402. The owner (the developer or their company) backs the agent with testnet USDC. B2B.

## Solution

1. The **owner** locks USDC in a **pool** (`fund`).
2. The pool **creates an agent**: it deploys an OpenZeppelin smart account with exactly one context rule (the agent's ed25519 key + the **covenant policy**) and no management rule. The signer, allowlists, and policy binding are fixed; the owner can amend numeric limits and expiry. The account grants the pool a USDC recovery allowance, valid for 3,000,000 ledgers from creation.
3. The agent **draws** up to its draw limit from the pool into its own account.
4. Every outgoing call from the account goes through the covenant: USDC transfers only to allowlisted **providers** (x402 or direct) and **recipients**, within per-transfer and total caps, before **expiry**; allowlisted **contract calls**; the pool's lifecycle functions. Anything else, including calls on the account itself, is rejected.
5. An agent may **delegate** a narrower covenant to a child, carved out of its own remaining allowance.
6. The owner (or a parent) can **revoke** and **close**. The owner can **amend** numeric limits and record dispute outcomes. `return_funds` remains available after covenant expiry or revocation, subject to the token allowance. Closing recovers the remaining wallet balance and settles consumed funding before releasing unused allocation.
7. Once all agents are closed, the owner can permanently **close the pool** (`close_pool`). The remaining pool USDC returns to the original owner in the same transaction. The pool cannot be funded or reused again; its history and late-refund recovery remain available.

*Humans configure, agents only execute inside limits.*

### Deployed cash-pool accounting v2

The deployed v2 pool implements the complete draw → spend → recover → close → withdraw lifecycle. AP2 mandates, intent records, and escrow are deferred; this keeps the existing pool, policy, and agent accounts.

- `locked` = the pool's actual USDC balance + outstanding agent advances. It is an accounting total, **not** the pool's cash balance. An advance includes money already spent until it is settled at closure.
- `sum_limits` = draw limits of all non-closed agents. Available funds are `locked - sum_limits`, always backed by cash in the pool.
- `close` atomically freezes spending, pulls back the agent's entire USDC balance, records unrecovered advances as `settled_spent`, and releases only the unused allocation. A child returns only that unused allocation to its parent. Children must close before their parent.
- `settle` freezes the requesting agent's spending while awaiting owner/parent closure. Expired agents cannot draw or delegate, but the owner can still recover and close.
- Use `return_funds` to reconcile an agent's advance. A raw transfer to the pool counts as an unattributed deposit instead; it is still available, but it does not update that agent's return history. `settled_spent` is net funding consumed at closure, not gross provider payment volume.

For example: draw 10 USDC, spend 3, then close. The pool recovers 7, settles 3, and releases 7 of allocation. The 3 already consumed can never be allocated or withdrawn again.

### Permanent pool shutdown

The console's **Close pool** replaces **Free pool**: revoke agents, recover and close them child-first, then invoke owner-only `close_pool()`. The final transaction requires zero open agents, allocations, and outstanding advances, returns all pool cash to the original owner, and sets `closed: true`. If the refund fails, shutdown rolls back. A maintained open-agent counter includes zero-limit delegated parents and avoids scanning every historical agent in the final transaction.

This is irreversible deactivation, not deletion of the contract or its history. There is no reopen/upgrade function. The pool rejects new funding, agents, draws, delegation, amendments, and other operational changes. `return_funds`, owner-only `withdraw`, and reads remain available so late USDC deposits can be recovered without reopening it. Closing agents and closing their pool are distinct operations; draining cash alone does not close a pool.

**Deployment:** accounting v2 and permanent shutdown are deployed on testnet (2026-10-25, 22:30:42 UTC). The default pool and the dashboard's **New pool** flow use pool WASM `cc1aadcf38ffeee5d15717e04f48f325024b7a47e57ca1548a8e9d49b731b464`. The policy, verifier, and agent-account WASM are unchanged and were checked byte-for-byte against the current build. The new pool was deployed empty; no old balances or agents were moved.

Existing pools are immutable and cannot be upgraded in place. The [previous deployment record](deployments/history/testnet-2026-10-25-legacy.json) is preserved, and the dashboard keeps its old default plus browser-saved pools selectable. Explicit legacy WASM hashes remain allowed for access and recovery, never for new deployments. Old pools retain **Recover funds** and **Return to wallet**; the console only offers permanent closure when `get_pool` includes the boolean `closed` field. Create a new pool owned by your connected wallet, fund it, and create new agents to use the new lifecycle. Moving funds from an old pool still requires its owner's separate signatures.

### Optional yield — v3 source, not yet activated

The new pool source supports both **investing pool USDC into a DeFindex vault** and **locking an existing transferable vault-share position**. It uses actual share custody, discounts estimated backing by 10%, redeems only missing cash during an agent draw, and returns shares in kind during closure. The console separates cash from estimated vault backing and requires owner-signed opt-in and bounded quotes. This buffer is not insurance; investment losses and unavailable liquidity can stop draws.

**The manifest and New pool flow still deploy cash-only v2.** The published DeFindex testnet vault uses a different USDC contract, so it is deliberately not enabled. Existing funds are untouched. See [yield design, trust boundaries, tests and activation requirements](docs/YIELD.md). A compatible reviewed vault and fresh v3 rollout are required before using yield on chain.

### Agent signer choice

The console supports **app-managed signers** and **your own runtime's public key**. App-managed keys are bound to the requesting pool owner's wallet, with an optional private-key download authorized through Freighter. Exporting gives the owner a copy; the app retains its signing copy. External runtimes keep their own private keys. The contracts accept the same public-key argument in either mode. See [console setup and key management](dashboard/README.md).

## Live URL + video *(to fill during the event)*

| Item | Link |
|---|---|
| Website | <https://kovan-protocol.vercel.app> |
| Agent install / guide | `/plugin install kovan --marketplace kovan-protocol/kovan` (Claude Code) · <https://kovan-protocol.vercel.app/agent.md> (any agent) |
| Signing page (for cloud agents) | <https://kovan-protocol.vercel.app/sign> |
| Demo video (2–4 min) | TBD |
| Backup video (unlisted) | TBD |
| Deck | TBD |

## Architecture: how Stellar is used

| Component | Stellar feature | Contract ID (testnet) |
|---|---|---|
| `kovan-pool` | Accounting v2; USDC recovery; irreversible pool shutdown; deploys agent accounts via `deployer()` | [`CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR`](https://stellar.expert/explorer/testnet/contract/CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR) |
| `kovan-covenant-policy` | OpenZeppelin smart-account policy (`stellar-accounts` 0.8.0) | [`CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2`](https://stellar.expert/explorer/testnet/contract/CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2) |
| `kovan-agent-account` (per agent) | OpenZeppelin smart account, frozen at creation | unchanged wasm hash `25dabe1afc7a1ef93a0bc7b40ffa784e0a70463db91c4b1812fc155768ead2d7`; created on demand, not migrated |
| `kovan-ed25519-verifier` | OZ verifier for External signers | [`CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4`](https://stellar.expert/explorer/testnet/contract/CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4) |
| USDC | Stellar Asset Contract | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Payments | x402 (facilitator-settled `transfer` from the agent account) | see evidence |

Full deployment record: [deployments/testnet.json](deployments/testnet.json).

### Testnet transaction evidence

Current pool rollout (confirmed by Stellar RPC):

| Step | What it shows | Tx |
|---|---|---|
| upload pool v2 | Current pool WASM uploaded at ledger 5388770 | [`74ca13…`](https://stellar.expert/explorer/testnet/tx/74ca13c5799421ec314cf5fa3fd946e4f0cb91be4f990849592ed6338ac4186f) |
| deploy pool v2 | Fresh pool at ledger 5388771; verified `accounting_version: 2`, `closed: false`, zero balance and zero agents | [`b2b2f1…`](https://stellar.expert/explorer/testnet/tx/b2b2f1f8fd3911504f91a5d9f959ffdb61a24e1b9a9fa9c29b56965eb26074f5) |

Historical lifecycle evidence below belongs to the legacy pool [`CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ`](https://stellar.expert/explorer/testnet/contract/CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ), including its first agent [`CAL7PY3A56BEDAN4QKNR5GPKK2UGXRHXG2Y3BX3XH5OHRPWGZS6JCCLZ`](https://stellar.expert/explorer/testnet/contract/CAL7PY3A56BEDAN4QKNR5GPKK2UGXRHXG2Y3BX3XH5OHRPWGZS6JCCLZ). These are not funding/agent records for the new pool. Shared verifier and policy deployments remain in use.

| Step | What it shows | Tx |
|---|---|---|
| deploy | verifier, policy, pool (second deployment, after review fixes) | [`ff4977…`](https://stellar.expert/explorer/testnet/tx/ff4977411d20f7915c400ae4edb031241a4631872fc1d7459b7acc2fb5ac54dc) [`8b25ea…`](https://stellar.expert/explorer/testnet/tx/8b25ea4e8112195e72bf779bdd80cb1ba690fe6b00b5433d403799b5e56416fd) [`aeb089…`](https://stellar.expert/explorer/testnet/tx/aeb089402970cc503063bf223978f875aa829ec1b0e0d9adcaaff70d2f4b476c) |
| fund | Owner locks 5 testnet USDC in the pool | [`647e1a…`](https://stellar.expert/explorer/testnet/tx/647e1a6bcdd1c85dc7bb31a708ba04f745aa14ed35ba71e63308e399fcc9f8ff) |
| create agent | Pool deploys a frozen agent account ($0.50 draw limit); events show one `Default` rule with one External signer and the covenant policy, plus the USDC allowance to the pool | [`6ff00f…`](https://stellar.expert/explorer/testnet/tx/6ff00f25f92b27da9034383d606e9e56428d480ad30c10019ace6323649f1033) |
| draw | Agent `CDECNZ57…` (key generated by the console) moves 0.50 USDC from the pool into its own account; only the draw amount leaves | [`ec4c12…`](https://stellar.expert/explorer/testnet/tx/ec4c127758282c38e493fa79c726264c564541d36a1ad1fc0545423de7411479) |
| x402 payment | Agent pays Stellar's x402 demo endpoint 0.01 USDC: 402 → signed `AuthPayload` → settled by x402.org → protected content returned | [`781a5f…`](https://stellar.expert/explorer/testnet/tx/781a5f2b560df66d3d6c587ef4f2a283e82421ce16b54565a9a64a8ba662775d) |
| blocked payment | Agent tries to pay an address outside its covenant; the covenant refuses in `__check_auth` with `#3904 PayeeNotAllowed` before anything is submitted (no transaction exists, by design) | simulation only |
| direct payment | Agent pays an allowlisted provider 0.20 USDC directly (same covenant rule as x402) | [`263d05…`](https://stellar.expert/explorer/testnet/tx/263d05036ee5bcc7520cef1dc39fb36a85ab4c90d5eda2caa5a62e7d2b0f4fb0) |
| create agent (console key) | Agent created for a console-generated key | [`0980a4…`](https://stellar.expert/explorer/testnet/tx/0980a449e94c152f5f841130dc6fd36cbdad85cff5694beeacbeac81bf017166) |
| delegate | Agent carves a child covenant | TBD |
| revoke | Owner kill switch | TBD |
| return funds | Agent returns 0.29 USDC to the pool | [`c455d6…`](https://stellar.expert/explorer/testnet/tx/c455d6a3229fe29f82ecd00d26de2d0c86ee76f365a8230bb96b153db71665b3) |

## Setup

### Use with your agent

Install Kovan into your agent, then ask it in plain words, e.g. *"Set me up a $100 Kovan pool with 2 agents."*

```text
Claude Code:   /plugin install kovan --marketplace kovan-protocol/kovan
               (older versions: /plugin marketplace add kovan-protocol/kovan, then /plugin install kovan@kovan)
Any agent:     "Read https://kovan-protocol.vercel.app/agent.md and follow it."
```

The agent prepares every transaction itself with [`kovan.mjs`](skills/kovan/scripts/kovan.mjs), one self-contained Node file. Each owner action opens a small wallet page on `127.0.0.1` where you approve in Freighter. The agent never holds your key, and you check the real transaction in Freighter's own window. Agents spend with their own keys, inside their covenant. Agents running in the cloud use the hosted [signing page](https://kovan-protocol.vercel.app/sign) instead. Details: [skills/kovan/SKILL.md](skills/kovan/SKILL.md) · [signer/README.md](signer/README.md).

### Developer SDK

[`@kovan/sdk`](sdk/README.md) is a standalone local TypeScript/ESM package for deploying/funding pools, creating agents, authorized payments and recovery/closure. The dashboard uses the same SDK. Applications supply their own configuration and owner/agent/fee-payer signers; no Kovan backend or keystore is required. It is **not yet published to npm**. Yield remains experimental and inactive on the default v2 deployment.

A standalone example completed the full cash lifecycle on a new isolated testnet pool using faucet XLM, including cap/revocation refusals, recovery and shutdown. See [execution evidence and scope](docs/SDK.md). This is separate from the historical USDC demo and does not activate yield or move existing funds.

```bash
cd sdk
npm ci
npm run build
npm test
# Read-only by default; --execute creates disposable testnet accounts and a new pool.
node examples/testnet-lifecycle.mjs
```

### Contracts and dashboard

Cash-only deployment verification snapshot (2026-10-25, before the v3 yield work): **231 tests** passed — 107 contract tests and 124 dashboard tests. Separately, RPC confirmed the new pool's deployed WASM hash and initial v2/shutdown state. The full spending/recovery lifecycle is covered by tests; it has not yet been replayed with funds on this new default pool. The newer local v3 suite has 132 regular contract tests and 144 dashboard tests, plus one separately run DeFindex-bytecode integration test; see [yield verification](docs/YIELD.md#verification).

Post-SDK merge verification snapshot (2026-10-26): **322 tests** passed — 132 contract tests, 149 dashboard tests, and 41 SDK tests. One optional DeFindex-bytecode integration test is ignored by the default contract run and excluded from this total. These local tests include experimental v3 code; they do not change the default v2 deployment.

```bash
rustup target add wasm32v1-none      # stellar CLI 26.1.0, cargo 1.95
make test                            # builds WASM and runs the contract tests
node dashboard/scripts/deploy-pool.mjs --check --source <identity> # read-only preflight (after build)
OWNER=<identity> make deploy         # testnet only; pool-only rollout when manifest exists
```

Run `make setup-js` to install/build the SDK and install the dashboard's local package dependency. `make test-js` rebuilds the SDK, refreshes that installed copy and checks both packages. With an existing manifest, deployment verifies the owner and unchanged shared code, archives the old manifest, deploys and verifies the new pool, and atomically updates the record while retaining legacy access. It does not move funds. It refuses changed shared dependencies rather than silently mixing bindings. Update the README's deployment evidence after a rollout, then run `cd web && npm run build` to synchronize the website snapshot. A bootstrap without any manifest uses the original full deployment path.

## Env vars

Names in [.env.example](.env.example). Never commit real values.

## Demo *(to fill during the event)*

Planned beats: a draw and a paid call → a blocked payment → delegation and revoke.

## Built during event vs prior work

Everything in this repo was written after Sun Oct 25 11:30 Lisbon. Before the event: planning docs only, and a throwaway x402 + smart-account proof of concept whose code was not reused.

## AI usage

AI tools were used with attribution: commits containing AI-written code start with `[ai]`. Users supply their own signer public keys or authorize the app to generate signer keys. Private keys are kept by the runtime/backend and returned only for an explicit owner-authorized export; they are not included in AI chat or committed. Design decisions were made in conversation and recorded in the design doc.

## Compliance by design

B2B, non-custodial, no return to the owner on locked funds, no token issued, no personal data on-chain. Testnet only. See the parent planning docs; not legal advice.

## Roadmap

Agent runtime with x402 payload builder for smart-account payers · dashboard · reputation (stellar-8004) · multiple pools per owner · mainnet with KYB.

## Team *(to fill during the event)*

## Testnet disclaimer

Hackathon prototype on Stellar **testnet only**. Testnet USDC has no value. Not audited. Not a financial product. Not legal advice.
