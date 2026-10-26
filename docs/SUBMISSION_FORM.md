# HackMeridian submission form: drafts

Copy each block into the matching field. Items marked **TODO** need a human.

---

## Tagline (≤ 120 characters)

```text
Shared USDC budgets your AI agents can't overspend: spending rules enforced on-chain by Stellar smart accounts.
```

---

## Description (Markdown, ≤ 8000 characters)

```markdown
**Kovan gives AI agents shared USDC budgets they can't overspend.** An owner locks testnet USDC in one pool. Each agent gets its own Stellar smart account, bound to a **covenant**: how much it may draw, which addresses it may pay, how much per payment and in total, and until when. The rules are enforced on-chain by the agent's own account, so a buggy, looping or prompt-injected agent can't break them. *Humans configure; agents only execute inside limits.*

### How it works

- **Pool** (Soroban contract): holds the owner's USDC and enforces one invariant: the sum of all agents' draw limits never exceeds what is locked. Only the drawn amount ever leaves the pool.
- **Agent wallet**: an OpenZeppelin smart account (`stellar-accounts` 0.8.0), deployed per agent by the pool, with exactly one rule (the agent's ed25519 key + the covenant policy) and no admin rule. Its signer and allowlists are frozen at creation: nobody can add a key or remove the policy.
- **Covenant policy**: checks every outgoing call. USDC transfers only to allowlisted **providers** (per-call APIs, x402) and **recipients**, within per-transfer and total caps, before expiry; allowlisted contract calls; nothing else, including calls on the wallet itself.
- **Owner control**: revoke an agent at any time (and its children), amend numeric limits, and pull funds back into the pool *without the agent's signature*, through an allowance the wallet grants the pool at creation. Agents can delegate a narrower covenant to a child agent, carved out of their own allowance.

The covenant doesn't trust the payment rail, it trusts the allowlist: an x402 payment and a direct USDC transfer look the same on-chain, and both are judged by payee and amount.

### What's different

Earlier Stellar hackathon projects put spending limits on a single agent wallet. Kovan is the treasury layer around them: one pool backs many agents with a guaranteed total, accounts are frozen at creation (no admin key, not even ours), the owner claws funds back without the agent's key, and agents delegate narrower budgets to sub-agents. On top of that: a smart-account x402 payer and agent-native setup.

### Agents that spend

Agents pay per call over **x402**. The standard x402 client can't sign for a smart account (C-address), so we build the OpenZeppelin `AuthPayload` ourselves and settle through the x402.org facilitator. On testnet, an agent paid Stellar's x402 demo endpoint from its covenant-bound wallet, and a payment to an address outside its covenant was refused by the account itself (`PayeeNotAllowed`) before anything was submitted.

### Built for agents, not just dashboards

Kovan installs into an agent like a skill: `/plugin install kovan --marketplace kovan-protocol/kovan` in Claude Code, or any agent can read `https://kovan-protocol.vercel.app/agent.md`. The agent then prepares everything itself with `kovan.mjs` (one Node file): it creates and funds pools and creates agents, and you approve each owner action in **Freighter** on a small local page. The agent never holds the owner's key. Agents spend with their own keys, inside their covenant. Cloud agents use a hosted signing page that builds the transaction in the owner's browser, so the agent doesn't even need the owner's address.

### Evidence

- Contracts, pool, policy and verifier deployed on Stellar testnet; IDs and a transaction evidence table (fund, create agent, draw, x402 payment, blocked payment, direct payment, return funds) are in the README.
- 460 tests across contracts (132), dashboard (251), SDK (48) and signing page (29), plus a live end-to-end SDK run on testnet: pool → fund → agent → draw → pay → revoke → close → close pool, with refusals for an over-cap payment and a payment after revocation.

**Testnet only.** Testnet USDC has no value. Not audited. Not a financial product.
```

---

## Problem solved

```text
Agents that do useful work (monitoring, research, trading signals) pay for their inputs per call: data feeds, RPC, APIs. x402 makes that possible, but the money has to come from somewhere. Today you either hand the agent a funded wallet and hope, or refill it by hand. A buggy, looping or prompt-injected agent can send everything it holds anywhere, and manual top-ups put a human back in every loop. It has happened: one manipulated prompt got the Freysa agent to release a ~$47K prize pool (2024), and malicious prompts made the AIXBT agent send 55.5 ETH, about $105K (2025).

Kovan replaces "trust the agent" with rules the agent can't change: one shared pool backs many agents, each agent can only draw its own limit, and its wallet can only pay approved addresses within caps and before expiry. The worst case is bounded by design, the owner can revoke and recover funds at any time, and agents keep running without manual refills.
```

---

## Challenges

```text
- Smart-account payer over x402: the standard @x402/stellar client signs only for classic accounts. We build and sign the OpenZeppelin AuthPayload for the agent's smart account ourselves, matching the facilitator's checks.
- A wallet the agent can't reconfigure: the agent account has a single rule and no admin rule, so it is frozen at creation. To keep the owner in control anyway, the wallet grants the pool a USDC allowance at creation, so the owner can pull funds back without the agent's key.
- Contract boundaries: Soroban forbids contract re-entry, so the covenant policy must be a separate contract from the pool (pool → wallet auth → policy would re-enter the pool).
- Edge cases that bypass naive policies: negative and zero amounts, muxed payees, non-i128 arguments, expiry boundaries, approve/transfer_from on USDC, calls on the wallet itself. Each has a test that fails if the rule breaks.
- Keeping humans in control in an agentic flow: agents prepare every transaction, but owners approve in their own wallet (Freighter); the agent never holds the owner's key, and a link can't choose contract code, policy, verifier or asset.
```

---

## What's next

```text
- A read-only watcher: a shareable live page and a CLI stream of every agent's draws, payments and limits, with alerts (cap nearly used, expiry soon).
- x402 payments built into the agent tool, and the SDK on npm.
- Co-signing: large or unusual payments require the owner's signature as well as the agent's (new wallet version; the policy already sees who signed).
- Reputation via stellar-8004 and limits that grow with good behaviour.
- More wallets (Stellar Wallets Kit), multiple pools per owner, cross-chain funding (CCTP).
- Mainnet only after an audit, with business (KYB) onboarding.
```

---

## Repository link

```text
https://github.com/kovan-protocol/kovan
```

## Project website link

```text
https://kovan-protocol.vercel.app
```

The site serves `/llms.txt`, `/llms-full.txt`, `/robots.txt` and `/sitemap.xml` (all checked live, 200).

## Demo video link

**TODO:** YouTube or Vimeo link (2–4 min). Required.

## Deck file

**TODO:** PDF/PPTX/HTML, ≤ 20 MiB. Required.

## Thematic track

```text
Stellar Composed: "Agents that spend"
```

(Builder track: Genesis, already assigned.)

## Tech stack (≤ 25, comma-separated)

```text
Stellar, Soroban, Rust, soroban-sdk, OpenZeppelin stellar-accounts, Stellar Asset Contract, USDC, x402, Stellar RPC, Stellar CLI, TypeScript, @stellar/stellar-sdk, Freighter, Node.js, Next.js, React, Tailwind CSS, GSAP, Vite, Vitest, esbuild, Vercel, GitHub Pages, GitHub Actions, Agent Skills
```

## Prior work disclosure

```text
All code in the repository was written during the event (from Sun Oct 25, 11:30 Lisbon). Before the event we had planning documents only (problem, rules, risks, an earlier "Action Bonds" design that we replaced), and a throwaway x402 + smart-account proof of concept whose code was not reused.

Third-party code we include, unmodified or nearly so: the OpenZeppelin ed25519 verifier example (stellar-contracts v0.8.0) as our signature verifier, and the Stellar Development Foundation's agent skills (stellar-dev-skill, Apache-2.0), vendored as reference material for AI agents. We build on open-source libraries (soroban-sdk, OpenZeppelin stellar-accounts, @stellar/stellar-sdk, Freighter API, Next.js and others).
```

## AI tooling note

```text
AI-assisted development throughout, with attribution: every commit containing AI-written code starts with [ai].

- Claude Code (Anthropic): design discussion and specs, Soroban contracts and their tests, the TypeScript SDK, the dashboard, the signing page and the agent tool (kovan.mjs), CI, docs, security-focused reviews, and testnet verification runs.
- Cursor (Cursor Agent): landing-page work: layout, motion, design-review fixes, evidence and test-count updates.

Humans made the product and design decisions and reviewed the changes. Owner keys are created and held by humans in their own wallets (Freighter / Stellar CLI); no AI handled them. Agent signing keys are generated by software (the console or `stellar keys generate`), never pasted into AI chats or committed. Testnet only.
```
