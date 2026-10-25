# Kovan Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A localhost web console where the owner (via Freighter) funds the pool and creates agents by filling in covenant parameters, agent actions run through a server-side signer, and every transaction and event is shown with its decoded result and explorer link.

**Architecture:** Next.js app in `dashboard/`. Owner actions build the transaction on the server (`/api/tx/build`), the browser signs with Freighter and submits via `/api/tx/submit`. Agent actions (`draw`, `pay`, `return`) run entirely in a server route that holds the agent's ed25519 secret from `.env` and builds the OpenZeppelin `AuthPayload` auth entry, mirroring the Rust e2e test. State and logs come from Stellar RPC: contract reads via simulation, logs via `getEvents` on the pool and policy. The pool gains events in a small contract change first.

**Tech Stack:** Next.js 16 (App Router, TypeScript), `@stellar/stellar-sdk` ^16.3 (pinned to what `@x402/stellar` supports), `@stellar/freighter-api` 6, Tailwind + shadcn/ui, `@x402/fetch` + `@x402/stellar` for the x402 beat (Task 7, gate-dependent).

**Spec:** design is `docs/superpowers/specs/2026-10-25-kovan-covenant-design.md` plus the decisions below.

## Decisions (from conversation, Sun Oct 25)

- Owner signs with **Freighter**; agent actions sign **server-side** with `AGENT_SECRET` from `.env` (testnet, human-generated, never committed).
- Console is local only; not deployed. Read-only parts can later go to Vercel.
- Pool emits events (`funded`, `agent_created`, `drawn`, `returned`, `revoked`, `amended`, `closed`, `delegated`) so logs need no custom storage.
- Contract error codes are decoded to names in the UI (`#3904 PayeeNotAllowed`).

## Global Constraints

- Testnet only. `NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org`, network passphrase `Test SDF Network ; September 2015`.
- Commits: `[ai] <short summary>`, author = user, no agent trailers.
- No secret in the repo. `.env.local` git-ignored; `.env.example` lists names.
- Numbers shown as USDC with 7 decimals (`5_000_000` → `0.50 USDC`); follow the number-formatting skill when rendering.
- Vocabulary: pool, covenant, draw limit, providers, recipients, revoke, return funds.

## Review Focus

1. A Freighter account other than the pool owner signs `fund`: expected a decoded `Error(Auth)` in the log, not a blank failure. Test in Task 4.
2. `AGENT_SECRET` missing or not matching the selected agent's key: expected a clear "agent key does not match account" message before any network call. Test in Task 5.
3. Expiry entered as hours is converted with ~5 s/ledger from the *current* ledger, not from 0. Test in Task 3.
4. Auth entry expiration for agent actions = latest ledger + 60; a stale entry retried gets re-signed, never replayed. Test in Task 5.
5. Event log survives an RPC window miss: `getEvents` only keeps ~24 h; show "older events unavailable" instead of an empty, silent list. Test in Task 6.

---

## File structure

```
contracts/pool/src/events.rs           # Task 1: event structs + emit helpers
dashboard/
  package.json, next.config.ts, .env.example
  app/layout.tsx, app/page.tsx         # single page: Pool | Agents | Log
  app/api/tx/build/route.ts            # Task 4: owner tx → unsigned XDR
  app/api/tx/submit/route.ts           # Task 4: signed XDR → send + poll
  app/api/agent/[action]/route.ts      # Task 5: draw | pay | return, server-signed
  app/api/state/route.ts               # Task 2: pool + agents via simulation
  app/api/events/route.ts              # Task 6: getEvents on pool + policy
  lib/stellar.ts                       # rpc server, network, contract ids from deployments/testnet.json
  lib/contracts.ts                     # typed invoke helpers (pool, policy, usdc)
  lib/authpayload.ts                   # Task 5: AuthDigestPreimage + AuthPayload builder (mirrors e2e test)
  lib/errors.ts                        # Task 2: code → name maps (PoolError, CovenantError, SmartAccountError)
  lib/format.ts                        # usdc(), ledgerFromHours()
  components/PoolPanel.tsx, CreateAgentForm.tsx, AgentCard.tsx, LogPanel.tsx, WalletButton.tsx
  tests/*.test.ts                      # vitest: format, errors, authpayload digest, expiry
```

---

### Task 1: Pool events

**Files:** Create `contracts/pool/src/events.rs`; modify `contracts/pool/src/contract.rs`, `src/lib.rs`, `src/test.rs`.

**Interfaces:** `#[contractevent]` structs: `Funded{amount}`, `AgentCreated{#[topic] agent, draw_limit}`, `Drawn{#[topic] agent, amount, drawn}`, `Returned{#[topic] agent, by, amount, drawn}`, `Revoked{#[topic] agent, by}`, `Amended{#[topic] agent, draw_limit}`, `Closed{#[topic] agent}`, `Delegated{#[topic] parent, child, draw_limit}`.

- [ ] Write failing tests in `test.rs` using `soroban_sdk::testutils::Events`: `fund_emits_funded`, `create_agent_emits_agent_created`, `draw_emits_drawn`, `delegate_emits_delegated` (assert last event topics/data).
- [ ] Run `cargo test -p kovan-pool events` → FAIL.
- [ ] Implement structs and `.publish(e)` calls at the end of each entrypoint.
- [ ] Run → PASS; `make build`; redeploy pool only: `stellar contract deploy --wasm …kovan_pool.wasm --alias kovan-pool …` with the same constructor args; update `deployments/testnet.json` and README IDs; `fund` 5 USDC again.
- [ ] Commit `[ai] pool: emit lifecycle events`.

### Task 2: Dashboard scaffold, state read, error decoding

**Files:** `dashboard/*` scaffold, `lib/stellar.ts`, `lib/contracts.ts`, `lib/errors.ts`, `lib/format.ts`, `app/api/state/route.ts`, `tests/format.test.ts`, `tests/errors.test.ts`.

**Interfaces:**
```ts
// lib/format.ts
export const usdc = (units: bigint | string) => string      // "0.50 USDC"
export const unitsFromUsdc = (s: string) => bigint          // "0.5" → 5000000n
export const ledgerFromHours = (latest: number, hours: number) => number  // latest + ceil(hours*3600/5)
// lib/errors.ts
export const decodeContractError = (msg: string) => { code: number; name: string } | null
// lib/contracts.ts
export async function readPool(): Promise<PoolInfo>
export async function listAgents(): Promise<Address[]>
export async function readAgent(id: string): Promise<AgentRecord & { covenant: CovenantState }>
```
Reads use `rpc.Server.simulateTransaction` on a dummy source (`NULL_ACCOUNT`) and `scValToNative`.

- [ ] `npx create-next-app@latest dashboard --ts --tailwind --app --eslint --src-dir=false --import-alias "@/*"`; add `@stellar/stellar-sdk@^16.3`, `@stellar/freighter-api@^6`, `vitest`; init shadcn with button, card, input, label, badge, table, textarea.
- [ ] Write failing vitest tests: `usdc(5000000n) === "0.50 USDC"`, `unitsFromUsdc("2") === 20000000n`, `ledgerFromHours(1000, 1) === 1720`, `decodeContractError("Error(Contract, #3904)")` → `{3904, "PayeeNotAllowed"}`, `#6` → `NotActive`, `#3003` → `ExternalVerificationFailed`.
- [ ] Run → FAIL. Implement. Run → PASS.
- [ ] `/api/state` returns pool + agents JSON; verify with `curl localhost:3000/api/state` showing `locked: "50000000"`.
- [ ] Commit `[ai] dashboard: scaffold, state reads, error decoding`.

### Task 3: Page layout, Pool panel, Create-agent form (no signing yet)

**Files:** `app/page.tsx`, `components/PoolPanel.tsx`, `components/CreateAgentForm.tsx`, `components/AgentCard.tsx`, `tests/covenant-form.test.ts`.

**Interfaces:** `buildCovenantArgs(form): { agent_pubkey: hex, draw_limit: bigint, covenant: CovenantParams }` (pure, tested). Form fields: agent public key (G… or 64-hex; G is decoded with `StrKey.decodeEd25519PublicKey`), draw limit (USDC), providers (one per line), provider per-transfer / total caps, recipients + caps, expiry hours, optional calls (contract, fn, amount arg index, cap).

- [ ] Failing tests: G-address → 32-byte hex; `expiry` uses `ledgerFromHours(latest, hours)`; empty recipients → caps 0; invalid key → error string.
- [ ] Run → FAIL. Implement form + pure builder. Run → PASS.
- [ ] Render page with Pool panel (from `/api/state`), agent cards, and the form (submit disabled until Task 4). Run the frontend-design-guidelines skill while styling; dense "workstation" direction, no gradients.
- [ ] Commit `[ai] dashboard: pool panel, agent cards, covenant form`.

### Task 4: Owner actions with Freighter

**Files:** `components/WalletButton.tsx`, `app/api/tx/build/route.ts`, `app/api/tx/submit/route.ts`, `lib/owner.ts`.

**Interfaces:**
```ts
POST /api/tx/build  { fn: "fund"|"create_agent"|"revoke"|"amend"|"close"|"return_funds"|"withdraw", args, source: G } → { xdr }   // simulated + assembled
POST /api/tx/submit { signedXdr } → { hash, status, events, error? }    // sendTransaction + poll getTransaction
```
Browser: `freighter.requestAccess()` → `signTransaction(xdr, { networkPassphrase })` → submit. Owner mismatch shows decoded `Error(Auth…)`.

- [ ] Failing test (vitest, node): `buildOwnerTx("fund", {amount: 1n}, OWNER)` returns base64 XDR with one `invokeHostFunction` op whose contract is the pool id (parse with `TransactionBuilder.fromXDR`).
- [ ] Run → FAIL. Implement build/submit routes. Run → PASS.
- [ ] Manual check against testnet: connect Freighter (owner key imported by a human), `fund 0.1 USDC` → log shows hash + explorer link; create one agent from the form → appears as a card. Record hashes in README evidence.
- [ ] Commit `[ai] dashboard: owner actions signed with Freighter`.

### Task 5: Agent actions, server-signed AuthPayload

**Files:** `lib/authpayload.ts`, `app/api/agent/[action]/route.ts`, `components/AgentCard.tsx` (buttons), `tests/authpayload.test.ts`.

**Interfaces:**
```ts
// lib/authpayload.ts
export function authDigest(account: string, signaturePayload: Buffer, ruleIds: number[]): Buffer
  // sha256(xdr(ScMap{account, context_rule_ids, signature_payload}))  keys sorted, as OZ README §6
export async function signAgentEntry(entry: xdr.SorobanAuthorizationEntry, opts: { account, verifier, pubkey, secret, networkPassphrase, expirationLedger }): xdr.SorobanAuthorizationEntry
  // sets nonce/expiration, computes HashIdPreimage::SorobanAuthorization hash, builds AuthPayload{signers: {External(verifier,pubkey): sig64}, context_rule_ids:[0]} as ScVal, puts it in credentials.signature
POST /api/agent/draw   { agent, amount }
POST /api/agent/pay    { agent, to, amount }        // USDC.transfer(agent, to, amount) — "pay stranger" is the blocked beat
POST /api/agent/return { agent, amount }            // pool.return_funds(agent, agent, amount)
```
Flow per action: build tx with source = a server fee-payer G (`FEE_PAYER_SECRET`, human-made) → simulate → for each auth entry whose address == agent, replace with `signAgentEntry` → assemble → sign tx with fee payer → send → poll → return decoded result. Guard: derive pubkey from `AGENT_SECRET` and compare with the account's rule-0 External signer key (read via simulation of `get_context_rule(0)`); mismatch → 400 before any submission.

- [ ] Failing tests: `authDigest` equals a vector computed by the Rust e2e (export one: add a `#[test] fn print_digest_vector` in Rust that prints account/payload/digest once; paste constants); `signAgentEntry` output has `signature_expiration_ledger == expiration` and `signature` is an `ScMap` with keys `context_rule_ids`, `signers`.
- [ ] Run → FAIL. Implement. Run → PASS.
- [ ] Manual on testnet with the first agent (`kova-keeper` key in `.env.local`): `draw 0.5` ✓ → `pay provider 0.2` ✓ → `pay stranger 0.1` ✗ decoded `#3904 PayeeNotAllowed` → `return 0.3` ✓. Record the four hashes in the README evidence table (`draw`, payment, `blocked payment`, `return funds`).
- [ ] Commit `[ai] dashboard: agent actions with server-signed AuthPayload`.

### Task 6: Event log panel

**Files:** `app/api/events/route.ts`, `components/LogPanel.tsx`, `tests/events.test.ts`.

**Interfaces:** `GET /api/events?since=<ledger>` → `{ events: {ledger, contract, topics, data, txHash}[], oldestAvailable }` from `rpc.getEvents` filtered to pool + policy ids; merged with a client-side list of transactions this session submitted (hash, fn, result).

- [ ] Failing test: `normalizeEvent(rawPoolEvent)` → `{kind:"drawn", agent, amount:"5000000"}`; `normalizeEvent(rawPolicyEnforced)` handled; unknown topic → `{kind:"other"}`.
- [ ] Run → FAIL. Implement. Run → PASS. Show "older events unavailable before ledger N" when `oldestAvailable > since`.
- [ ] Commit `[ai] dashboard: event log`.

### Task 7 (gate 16:00–18:00): x402 payment beat

**Files:** `app/api/agent/pay-x402/route.ts`, `lib/x402.ts`.

Flow: fetch the provider URL → on 402, read `payment-required` header → build `USDC.transfer(agent, payTo, amount)` → `signAgentEntry` with expiration = latest + ceil(maxTimeoutSeconds/5) → serialize tx XDR (source = fee payer, unsigned) → retry with the `payment-signature` header per `@x402/fetch`'s encoding (use `@x402/core` helpers for header encoding only) → facilitator `https://x402.org/facilitator`. Demo provider: `https://stellar.org/x402-demo/api/protected/testnet` (0.01 USDC, `payTo` must be allowlisted as a provider when creating the agent).

- [ ] Manual: one settled payment from the agent account; record hash as `x402 payment`. If the facilitator rejects the C-address entry, record the exact error in RISKS and use the owner-held G-account fallback.
- [ ] Commit `[ai] dashboard: x402 payment from the agent account`.

## Checkpoint mapping (Lisbon)

| When | Done |
|---|---|
| 15:30 | Tasks 1–3 |
| 16:30 | Task 4 (owner via Freighter) |
| 18:00 | Task 5 + 7 gate decision |
| 20:00 | Task 6; evidence table complete except x402 if fallback |
