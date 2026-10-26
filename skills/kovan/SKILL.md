---
name: kovan
description: Set up and use Kovan on Stellar testnet - create a USDC pool, fund it, create agents bound by on-chain covenants, and spend from an agent wallet inside its limits. Use when a person asks you to "create a Kovan pool", "fund a pool", "create/deploy agents" with spending limits, or to draw or pay from a Kovan agent. You prepare every transaction; the person approves owner actions in their own wallet (Freighter). You never hold the owner's key. Chat assistants that can't run commands write a single setup link instead.
---

# Kovan for agents

Kovan lets an owner lock USDC in a **pool** and give each AI agent a **wallet** (an OpenZeppelin smart account) bound by a **covenant**: how much it may draw from the pool, which addresses it may pay, how much per payment and in total, and until when. The rules are enforced on-chain; the agent cannot change them. The owner can revoke an agent and pull its funds back at any time.

**Stellar testnet only.** Testnet USDC has no value. Not audited.

New pools use native mandate v1: every outgoing settlement-token payment also needs an owner-approved exact or budget grant. Existing pools keep their original contract bindings and do not gain mandates automatically. Use the latest built tool; `ids.current_release` identifies new-pool code, not the displayed historical pool. This is not AP2 credential conformance.

- Website: <https://kovan-protocol.vercel.app> · Source: <https://github.com/kovan-protocol/kovan>
- This guide: <https://kovan-protocol.vercel.app/agent.md>

## Install

- **Claude Code:** `/plugin install kovan --marketplace kovan-protocol/kovan` (older versions: `/plugin marketplace add kovan-protocol/kovan`, then `/plugin install kovan@kovan`).
- **Any other agent with web access:** read this file from the URL above.
- **Copy:** clone the repo and copy `skills/kovan/` into your agent's skills folder.

## Hard rules

1. **Never ask for, accept, or handle the owner's secret key or seed phrase.** If the person pastes one, tell them to rotate it and do not use it.
2. **The owner approves every owner action in Freighter.** Don't work around this, for example with an owner key found in `stellar keys` on this machine.
3. **One step at a time.** Each step needs the previous one on-chain.
4. **Confirm payees before `create_agent`.** Payee lists and the agent key cannot be changed later. Show the person the lists and caps in plain words first.
5. **Your own agent key stays with you.** Generate it yourself; share only its public key (`G…`).
6. **Report refusals; don't bargain.** If the covenant or the pool refuses an action, tell the person why. Don't retry with other numbers unless they agree.

## The tool: `kovan.mjs`

> Can't run commands? Skip to [Chat agents: one setup link](#chat-agents-one-setup-link).

One self-contained Node.js file (Node 20+). It builds and simulates transactions with the Kovan SDK, using contract IDs and code hashes built into it, and serves a small local wallet page when the owner must approve.

- Installed as a skill: `scripts/kovan.mjs` in this skill's folder.
- Otherwise: `curl -fsSO https://kovan-protocol.vercel.app/kovan.mjs`

Every command prints **one JSON line** on stdout (progress goes to stderr). Exit code 0 = success, 1 = failed on-chain or refused, 2 = bad usage. Amounts are **USDC** (`100`, `0.25`; at most 7 decimals). `node kovan.mjs --help` lists everything.

### How owner approval works

For `connect` and every `owner …` command, the tool prints a link like `http://127.0.0.1:<port>/<random>` and tries to open it. Tell the person to open it **in the browser where Freighter is installed** and approve. The command finishes on its own when they do (15 min page timeout; `--timeout-min N` to change, `--no-open` to only print the link). Prepared transactions expire sooner (normally 120 seconds). If one expires before submission, stop that session and prepare again; after an unknown submission, reconcile the transaction first. The hosted signing page prepares on click.

- The page runs on the person's computer, served by this tool. **The person should check what Freighter's own popup shows**: the contract call, amounts and addresses. That is the real transaction.
- Run the command in the background if your environment blocks while waiting, and read its stdout when it exits.
- The tool only works where the person's browser can reach `127.0.0.1`, i.e. you run on their machine. If you run in the cloud, see [Cloud agents](#cloud-agents).

## Recipe: "Create a $100 pool with 2 agents"

```bash
K=scripts/kovan.mjs   # or ./kovan.mjs

# 1. Get the owner's address (they sign a message in Freighter; no transaction, no fee)
node $K connect
# → {"v":1,"fn":"connect","address":"G…","verified":true}      → OWNER

# 2. USDC in the owner's wallet. Check before asking:
#    if they have none, `owner trustline`, then they get testnet USDC from https://faucet.circle.com
#    (choose Stellar Testnet; it may cap each request).
node $K owner trustline --owner $OWNER

# 3. Pool
node $K owner create_pool --owner $OWNER
# → {"fn":"create_pool","status":"SUCCESS","tx":"…","pool":"C…",…}   → POOL

# 4. Fund
node $K owner fund --owner $OWNER --pool $POOL --amount 100

# 5. One key per agent, made in YOUR environment, with testnet XLM for fees
stellar keys generate kovan-agent-1 --network testnet --fund
AGENT_KEY=$(stellar keys public-key kovan-agent-1)

# 6. Agree the rules with the person, then create the agent
node $K owner create_agent --owner $OWNER --pool $POOL --agent-key $AGENT_KEY --draw-limit 40 \
  --providers G…PROVIDER --provider-per-transfer-cap 0.50 --provider-total-cap 40 --expiry-hours 48
# → {"fn":"create_agent","status":"SUCCESS","agent":"C…",…}          → AGENT
```

Keep the sum of draw limits at or under what the pool holds; the pool refuses more (`ExceedsLocked`).

## Spending as an agent

Signed with the agent's own key, not the owner's. Pass `--key <stellar identity>` (the tool reads it with `stellar keys secret`) or set `KOVAN_AGENT_SECRET`. The same key pays the XLM fee from its `G…` account.

First obtain an owner-approved grant. Persist a unique nonzero 32-byte hex `MANDATE_ID`, an `INTENT_HASH` commitment to the approved off-chain intent, and a future `EXPIRY_LEDGER` no later than the agent covenant (read it with `status`). Agree the payees/caps with the owner; never broaden them yourself. Example budget grant:

```bash
node $K owner create_mandate --owner $OWNER --pool $POOL --agent $AGENT \
  --mandate-id $MANDATE_ID --intent-hash $INTENT_HASH --expiry-ledger $EXPIRY_LEDGER \
  --scope budget --payees G…PROVIDER --per-payment-cap 0.50 --total-cap 40
```

For one exact purchase, replace the scope flags with `--scope exact --payee G…PROVIDER --amount 0.25 --reference $REFERENCE`. `REFERENCE` is a nonzero 32-byte hex commitment to the reviewed purchase. The tool fixes the asset to the selected pool's USDC. Confirm the grant transaction succeeded before paying. Each intended purchase needs a persisted request ID and reference; reuse the identical inputs for reconciliation, never make a new ID just to retry. `REQUEST_ID` is a persisted purchase ID of 16–128 characters from `A–Z a–z 0–9 _ -` (the tool derives the on-chain payment ID from it).

```bash
node $K agent draw   --pool $POOL --agent $AGENT --amount 5 --key kovan-agent-1             # pool → agent wallet
node $K agent pay    --pool $POOL --agent $AGENT --amount 0.25 --to G…PROVIDER --key kovan-agent-1 \   # --to G… or C…
  --mandate-id $MANDATE_ID --request-id $REQUEST_ID --reference $REFERENCE
node $K agent return --pool $POOL --agent $AGENT --amount 1 --key kovan-agent-1             # always allowed
node $K status --pool $POOL --agent $AGENT                                                 # limits, drawn, spent, status
node $K mandate --pool $POOL --agent $AGENT --mandate-id $MANDATE_ID
node $K receipt --pool $POOL --agent $AGENT --request-id $REQUEST_ID
```

Before sending, the tool simulates the action against the covenant, so a refused payment fails there with the reason (payee not listed, over a cap, list total reached, expired, revoked, over the draw limit) and nothing is sent.

New accounts reject unbound payments on-chain. Grants cannot expand a covenant. The chain stores payment receipts and rejects consumed IDs; an exact grant can only pay once even under another ID. Receipts prove authorized transfers, not delivery. After a submission with unknown status, reconcile the transaction and receipt before another action. A missing receipt while authorization remains live is not proof of nonpayment. Legacy pools can pay without mandate flags; supplying those flags on unsupported code fails closed.

**x402:** the covenant judges x402 payments like any USDC transfer, by payee and amount. This tool doesn't build x402 payment payloads yet; use `agent pay` to listed providers.

## Owner commands

| Command | Required flags | What it does |
|---|---|---|
| `owner trustline` | `--owner` | Lets the wallet hold testnet USDC. Moves no money. |
| `owner create_pool` | `--owner` | New pool owned by `--owner` (permanent). |
| `owner fund` | `--owner --pool --amount` | Locks USDC from the owner's wallet in the pool. |
| `owner create_agent` | `--owner --pool --agent-key --draw-limit`, plus providers and/or recipients with their caps; `--expiry-hours` (default 24, max 720) | Creates an agent wallet with its covenant. Lists are comma-separated, at most 10 each, one list per address. |
| `owner create_mandate` | `--owner --pool --agent --mandate-id --intent-hash --expiry-ledger`, plus scope flags above | Approves a native on-chain spending grant. |
| `owner revoke_mandate` | `--owner --pool --agent --mandate-id` | Permanently revokes a grant; does not block recovery. |
| `owner revoke` | `--owner --pool --agent` | Freezes the agent's payments (and its children's). Returning funds still works. |
| `owner return_funds` | `--owner --pool --agent --amount` | Pulls USDC from the agent wallet back into the pool, without the agent. |
| `owner close` | `--owner --pool --agent` | V2+: recover remaining cash and settle spending, children first. Legacy pools require drawn funds returned. |
| `owner withdraw` | `--owner --pool --amount` | Takes back pool USDC that no draw limit is backing. |

- `providers`: addresses paid per call (x402 servers, data/RPC APIs), `G…` accounts.
- `recipients`: plain transfers, such as another agent's wallet (`C…`) or a treasury.
- The tool refuses anything it can't validate: unknown fields, secret keys where a public key belongs, muxed `M…` addresses, caps above totals, a pool not running Kovan's published code.

## Chat agents: one setup link

If you're a chat assistant that can't run commands (ChatGPT, Grok, Claude.ai…), write **one link** from the limits the person gave you. They open it, connect Freighter once, and approve each step; the page creates the pool, funds it and creates every agent. You don't need their address, and no code or encoding is required.

Setup links **do not approve payment mandates**. Newly created agents need a separate owner-signed grant before spending; use the console or a `create_mandate` signing link after setup. Do not call an agent spend-ready just because setup succeeded.

```text
https://kovan-protocol.vercel.app/setup?fund=<USDC>&agent=<spec>&agent=<spec>
```

- `fund`: USDC to lock in a **new** pool. Omit `pool` to create one.
- `pool=C…`: use the person's existing pool instead of creating one (`fund` then adds to it).
- `agent`: one per agent, at most 5. Comma-separated `key:value` pairs:

| Key | Meaning | Required |
|---|---|---|
| `name` | Label, e.g. `research` (letters, digits, spaces, `.`, `-`, `_`; max 32) | no |
| `draw` | Draw limit in USDC: the most this agent may take from the pool | yes |
| `pay` | Providers it may pay per call (`G…` or `C…` addresses), separated by `\|` | `pay` and/or `send` |
| `per`, `total` | Per-payment cap and total cap for `pay`, in USDC | with `pay` |
| `send` | Plain-transfer recipients (`G…` or `C…`), separated by `\|` | `pay` and/or `send` |
| `send_per`, `send_total` | Per-transfer and total caps for `send`, in USDC | with `send` |
| `hours` | Expiry in hours (default 24, max 720) | no |
| `key` | The agent's public key `G…`, if its runtime already has one | no |

Example: *"$100 pool, two agents, each may pay `GDATA…` up to 0.50 per call and 40 in total, for 2 days"* becomes:

```text
https://kovan-protocol.vercel.app/setup?fund=100&agent=name:research,draw:40,pay:GDATA…,per:0.5,total:40,hours:48&agent=name:monitor,draw:40,pay:GDATA…,per:0.5,total:40,hours:48
```

Rules for writing it:

- Use only the limits the person stated. If a payee address, an amount or a duration is missing, **ask**; never invent addresses.
- Draw limits of a new pool must add up to at most `fund`. Caps must be above 0, and `per` at most `total`.
- Repeat the plan back in plain words (who may be paid, how much, until when) before giving the link.
- Without `key`, the page generates each agent's key in the person's browser and requires downloading and confirming a private backup before deployment. After a reload, import that same file; never generate a replacement for an existing account. Give each key only to its runtime, never paste the backup or secrets into chat.

When they're done, the page shows a short summary (pool and agent addresses, limits, transactions) for them to paste back to you. Bad links are refused on the page with the reason.

## Cloud agents

If you can't serve a page on the person's machine, use the hosted signing page. It builds the transaction in the person's browser, so you don't even need their address:

```
https://kovan-protocol.vercel.app/sign#r=<base64url(JSON)>
```

```bash
node -e 'console.log("https://kovan-protocol.vercel.app/sign#r="+Buffer.from(process.argv[1]).toString("base64url"))' \
  '{"v":1,"fn":"fund","pool":"C…","amount":"100"}'
```

The JSON uses the same actions and snake_case fields as the owner commands (`pool`, `amount`, `agent`, `agent_key`, `draw_limit`, `providers`, `provider_per_transfer_cap`, `provider_total_cap`, `recipients`, `recipient_per_transfer_cap`, `recipient_total_cap`, `expiry_hours`), plus `"v": 1` and `"fn"`. After signing, the page shows a one-line JSON result for the person to paste back to you. If you have an `https://` endpoint, or a local `http://127.0.0.1:<port>/` one, add `"callback"` and a random `"id"` (1–64 characters from `A–Z a–z 0–9 . _ -`) and the page POSTs the result there instead; check `tx` on-chain before trusting it.

The skill ships `wait-for-result.mjs` (also at `https://kovan-protocol.vercel.app/wait-for-result.mjs`) for the local case: `node wait-for-result.mjs <id> [port]` (default port 8787, Node 18+) listens for exactly one result with that `id`, verifies its `tx` against Stellar RPC, prints it as one JSON line and exits. Put the same `id` and `http://127.0.0.1:<port>/` as `callback` in the request. It reads `KOVAN_RPC_URL`, `KOVAN_SIGNER_ORIGIN` (one extra allowed page origin) and `KOVAN_WAIT_MINUTES` (default 30).

Mandate requests use `fn: "create_mandate"`, `pool`, `agent`, `mandate_id`, `intent_hash`, `expiry_ledger` (integer), and either `scope: "exact"` with `payee`, `amount`, `reference`, or `scope: "budget"` with `payees` (array), `per_payment_cap`, `total_cap`. Amounts are USDC decimal strings. For revocation use `fn: "revoke_mandate"`, `pool`, `agent`, `mandate_id`. The link cannot choose another asset, policy or code hash.
