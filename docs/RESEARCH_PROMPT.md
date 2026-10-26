# Research brief: Kovan — what to finish, what to improve, what to say

Use this prompt with a deep-research agent (or paste it into a fresh Claude/ChatGPT session). It is self-contained; attach the repo if the tool can read files.

---

## Prompt

You are a senior Stellar/Soroban engineer and a hackathon judge rolled into one. Research and evaluate **Kovan**, a HackMeridian 2026 project (Lisbon, Stellar Composed track, theme "Agents that spend"), and produce a prioritized plan for the remaining ~18 hours plus a product roadmap. Be concrete, cite sources (URLs, repo paths, line numbers), and separate facts you verified from opinions.

### What Kovan is

An owner locks USDC in a **pool** (Soroban contract). The pool creates **agents**: each agent is an OpenZeppelin smart account (C-address) whose only authorization rule is `agent ed25519 key + covenant policy`, with no management rule, so the rule set is frozen at creation. The **covenant** (a shared policy contract, one record per agent) decides every call the wallet authorizes: USDC transfers only to allowlisted `providers`/`recipients` within per-transfer and total caps before an `expiry`; `calls` allowlist for other contracts; pool lifecycle functions; transfers back to the pool always allowed; calls on the wallet itself always refused. The pool enforces `Σ draw_limit(open agents) ≤ locked`. Lifecycle: `fund → create_agent → draw → (pay via x402 or direct) → return_funds → revoke/amend/settle/close → withdraw`. Agents can `delegate` child agents with subset covenants carved from their own limit. Principle: *the covenant doesn't trust the payment rail, it trusts the allowlist.* Tagline: *Humans configure, agents only execute inside limits.*

### Current state (verified on 2026-10-25, Stellar testnet)

- Repo: https://github.com/kovan-protocol/kovan (`main`). Contracts in `contracts/` (Rust, soroban-sdk 28.0.0, OpenZeppelin stellar-accounts 0.8.0): `pool`, `covenant-policy`, `covenant-types` (rlib), `agent-account`, `ed25519-verifier`. 87 Rust tests incl. signed end-to-end `AuthPayload` tests with no mocks.
- Current testnet pool: `CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR` (accounting v2 + permanent shutdown, deployed empty). Record: `deployments/testnet.json`. The unchanged policy, verifier and agent-account WASM are reused.
- New source (not deployed): pool v3 adds a single-vault DeFindex adapter for investing cash or locking existing shares, discounted backing, redemption on draw, and in-kind recovery. No vault is enabled: the published testnet vault uses a different underlying USDC address. See `docs/YIELD.md`; do not confuse tested local support with live yield availability.
- Historical testnet evidence: pool `CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ`, policy `CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2`, verifier `CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4`, agents `CAL7PY3A56BEDAN4QKNR5GPKK2UGXRHXG2Y3BX3XH5OHRPWGZS6JCCLZ` (provider = owner) and `CCRBQJYCSQFERP5NCTCHACOSDIJ5HT3IPZL5KULMK4MP2UZREY6XFCFF` (provider = x402 demo payTo). Archive: `deployments/history/testnet-2026-10-25-legacy.json`. These agents and funds were not migrated.
- Console (`dashboard/`, Next.js 16, stellar-sdk 16.4, Freighter 6): pool selector + create pool, fund, create agent form (covenant params), agent cards (limit, drawn, balance, spent, covenant), agent actions (draw/pay/return) signed server-side with `AGENT_SECRET`, **x402 v2 endpoint payment** built against the spec (`payment-required` / `payment-signature` / `payment-response`), event log from RPC. 60 vitest tests; the TS `AuthPayload` digest is pinned to a Rust vector; testnet decoded the payload shape (`#3016 UnauthorizedSigner` for a wrong key).
- **Not yet proven on-chain:** any agent-side transaction (draw, pay, blocked pay, x402 settlement through x402.org). Blocked only on operator steps (Freighter import, `.env.local` secrets).
- Design doc: `docs/superpowers/specs/2026-10-25-kovan-covenant-design.md`. Plans: `docs/superpowers/plans/`. Reviews found and fixed: close/amend status guards, delegate subset including `amount_arg`, revoked agents can always return funds, fee-payer signature borrowing, empty-env overrides, error decoding.
- Known deferred issues: returned earnings above `drawn` not added to `locked`; `draw`/`delegate` allowed after covenant expiry; pool `amend` doesn't cascade to children; children's total caps not carved from parent's; USDC allowance to pool lasts ~174 days and can't be renewed; `context_rule_ids` fixed to one entry per auth entry (nested invocations like a FeeForwarder or Trustless Work `fund_escrow` would need per-context ids); single `AGENT_SECRET` for all agents in the console; lint errors in two React components.

### Ecosystem facts already established

- x402 exact/Stellar spec: client signs auth entries only; facilitator rebuilds with its own source, re-simulates, requires one `transfer` event, rejects sub-invocations; supports C-account payers. `@x402/stellar`'s client cannot sign for a C-address (stellar-base `authorizeEntry` hardcodes ed25519). x402.org facilitator advertises `stellar:testnet`, fees sponsored. Demo endpoint: `https://stellar.org/x402-demo/api/protected/testnet` (0.01 USDC to `GCHEI4PQEFJOA27MNZRPQNLGURS6KASW76X5UZCUZIXCOJLKXYCXOR2W`).
- OpenZeppelin stellar-contracts 0.8.0: `stellar-access` (admin + roles, `#[only_admin]`, `#[only_role]`), `stellar-contract-utils` (`Pausable`, `Upgradeable`), `stellar-fee-abstraction` (FeeForwarder: agents pay fees in USDC, relayer pays XLM), OZ Relayer (Stellar sponsored txs, x402 facilitator plugin `OpenZeppelin/relayer-plugin-x402-facilitator`), `smart-account-kit` (passkeys, no x402). Audit v0.8.0 caveats: shared storage keyspace, Delegated signer CR-01.
- Trustless Work (escrow-as-a-service on Soroban, V2 testnet, API key): roles approver / service provider / release signer / receiver / platform / dispute resolver; `fund_escrow(signer, …)` nests a token transfer; funder is not a role. Fit: per-task payments with delivery risk; not per-call API payments.
- Stellar agent CLI docs compare spending controls (allowances, multisig, zero-XLM agents, claimable balances) but no on-chain policy per agent; stellar-8004 is a reputation registry (not integrated).
- Judging rubric: Thematic 20, User Value 20, Technical 15, Innovation 15, Progress 10, Market 10, UX 10. Submission needs: public repo, README with tx evidence, 2–4 min video, deck < 20 MiB, live URL. Deadline Mon 2026-10-26 12:00 Lisbon.

### Questions to answer

**A. Finish (next 18 h), ranked by rubric impact per hour**
1. What is the minimal evidence set that proves the full loop on testnet (draw, x402 payment settled by x402.org, blocked payment with decoded `#3904 PayeeNotAllowed`, revoke, return, delegate)? Which of these are most likely to fail and what is the fallback for each?
2. Should the covenant become a first-class, named, shareable object (N agents → one covenant id) before the demo? Estimate contract + console effort and demo value. If yes, immutable covenants with expiry inside, or amendable?
3. Should the pool add OZ `AccessControl` (owner vs operator) and `Pausable` before the pitch? Effort, risk of breaking the deployed flow, and which storage-key collisions to test.
4. Which deferred issues above would a judge or a security-minded user actually hit in a 3-minute demo or a 5-minute code read? Which can stay on the list?
5. What should the live URL be: the local console deployed read-only to Vercel (no secrets), or a static evidence page? What breaks when `AGENT_SECRET`-dependent routes are absent?

**B. Improve (product and architecture)**
6. Compare Kovan against: Stellar agent CLI allowances/multisig, Coinbase x402 spending patterns, Safe/ERC-4337 session keys and spending-limit modules on EVM, Solana agent wallets with policies (e.g. Squads, Turnkey policies), Trustless Work escrow, stellar-8004 reputation, REAPP/Rail402 if findable. Where is Kovan genuinely different, where is it behind, and what claim should the pitch *not* make?
7. Should covenant enforcement stay in a shared policy contract or move into each agent wallet's `__check_auth`? Weigh OZ framework benefits (passkeys, verifiers, audits) against simplicity and per-tx cost. Recommend.
8. Fee model: keep a server fee payer, adopt OZ fee abstraction (agent pays fees in USDC via FeeForwarder + relayer), or something else? What covenant changes does fee abstraction force (nested contexts, approve calls)?
9. Trust model: where does trust sit today (owner, console server holding the agent key, facilitator, provider)? Rank the removals by value: agent-held keys / passkeys / TEE, third-party dispute resolver or timelock on `close`, reputation to stellar-8004, provider delivery via escrow.
10. Economics: who pays what (XLM fees, facilitator, provider), what a 1¢ API call costs end to end on Stellar today, and whether the covenant's caps make sense at those sizes.
11. Compliance posture (testnet, B2B, non-custodial, no return to owner): which claims are safe to make on stage under MiCA/AML/MiFID framing, and which words to avoid.

**C. Say (pitch, 3 minutes, 8 slides)**
12. Propose the three demo beats and the exact on-screen evidence for each.
13. Draft answers to the hard questions: "isn't this just a prepaid wallet?", "why not multisig/allowances?", "why OpenZeppelin?", "what if the facilitator is malicious?", "what if the owner key leaks?", "how is this not a lending product?", "why Stellar and not EVM?".
14. One-line roadmap with the integrations above in the right order.

### Output format
1. Executive summary (10 lines).
2. Ranked task list for the next 18 h with effort, rubric points at stake, and fallback.
3. Architecture recommendations (questions 2, 3, 7, 8) with a decision each.
4. Competitive table (question 6).
5. Trust and economics (9, 10, 11).
6. Pitch material (12–14).
7. Sources.

Flag anything in the brief you could not verify. Do not invent contract IDs, library APIs or prices; say "unverified" instead.
