---
title: Concepts
description: Pools, agent wallets, covenants, the lifecycle, delegation and the guarantees.
---

# Concepts

> *The pool is the bank. Each agent's wallet holds its own funds. The covenant says how much it may take and what it may do.*

## Pool

A Soroban contract that holds the owner's USDC. It enforces one thing: **how much each agent may draw**.

- The owner **funds** the pool. Funds become *locked*.
- Creating an agent reserves a **draw limit** for it. The sum of all active draw limits never exceeds what is locked.
- An agent **draws** up to its limit into its own wallet. Only the drawn amount ever leaves the pool.
- The owner can **withdraw** only what no draw limit is backing.
- When every agent is closed, the owner can permanently **close the pool**: the remaining USDC returns to the owner in the same transaction, and the pool can't be funded again.

## Agent wallet

An [OpenZeppelin smart account](https://github.com/OpenZeppelin/stellar-contracts) (a `C…` address), deployed by the pool for each agent.

- It has **exactly one rule**: the agent's ed25519 public key (checked by a shared verifier contract) plus the covenant policy.
- It has **no admin rule**, so it is **frozen at creation**. Nobody, including the owner and the agent, can add a signer, change the allowlists or remove the policy.
- At creation it grants the pool a USDC **allowance** (valid for 3,000,000 ledgers, about 174 days). That's how the owner can pull funds back without the agent's signature. On current-release accounts the pool renews this allowance before each recovery; legacy (pre-recovery-v1) accounts keep the original finite window.

## Covenant

The rules for one agent, checked by the covenant policy on **every** call the wallet authorizes.

| Part | Rule |
|---|---|
| **draw** | The most USDC that may move from the pool into this wallet. Returned funds can be drawn again. Checked by the pool. |
| **providers** | Addresses paid per call (x402 resource servers, data/RPC APIs), with a per-transfer cap and a total cap |
| **recipients** | Plain transfers, such as another agent's wallet or a treasury, with their own per-transfer and total caps |
| **calls** | Other contract functions the wallet may call, optionally with a cap on one amount argument. Empty by default. |
| **expiry** | A ledger number. From then on, payments and calls are refused. Returning funds still works. |

A USDC transfer passes only if **all** of these hold: it's the pool's USDC contract, the function is `transfer`, `0 < amount ≤ per-transfer cap`, the list's running total stays within its total cap, the payee is on that list, the current ledger is before expiry, the covenant isn't revoked and, on current-release accounts, the payment carries an owner-approved **mandate** binding (refused with `#3915 MandateRequired` otherwise). A transfer **back to the pool** is always allowed and needs no mandate.

Everything else is refused: `approve` or `transfer_from` on USDC, calls on the wallet itself, unlisted contracts, muxed `M…` payees.

The covenant doesn't trust the payment rail, it trusts the allowlist. An x402 payment and a direct transfer look the same on-chain, and both are judged by payee and amount.

## Lifecycle

**Owner** (signed by the pool owner):

| Function | Effect |
|---|---|
| `fund(amount)` | Locks USDC in the pool |
| `create_agent(agent_pubkey, draw_limit, covenant)` | Deploys the agent's wallet with its covenant. Fails if total draw limits would exceed what's locked. |
| `amend(agent, draw_limit, amendment)` | Changes numeric limits and expiry. Can't go below what the agent already drew, or break the pool's invariant. |
| `revoke(agent, by)` | Freezes the agent's payments and calls, and its children's. Returning funds keeps working. |
| `return_funds(agent, by, amount)` | Pulls USDC from the agent's wallet back into the pool, using the allowance |
| `close(agent, by)` | Final. Recovers what's left in the wallet, settles what was spent, and releases the unused draw limit. |
| `withdraw(amount)` | Takes back USDC no draw limit is backing |
| `close_pool()` | Permanent. Only when every agent is closed. Remaining USDC returns to the owner. |
| `resolve_dispute(agent, outcome)` | Records the owner's ruling on a dispute |
| `create_mandate(agent, params)` | Approves an immutable `exact` or `budget` payment grant for one agent (current release) |
| `revoke_mandate(agent, id)` | Ends a grant; payments under it stop |

**Agent** (signed by the agent's wallet, so its covenant applies too):

| Function | Effect |
|---|---|
| `draw(agent, amount)` | Pool → agent wallet, within the draw limit |
| `return_funds(agent, agent, amount)` | Agent wallet → pool. Always allowed, even after expiry or revocation. |
| `settle(agent)` | Freezes the agent's own spending and asks the owner to close it |
| `dispute(agent, by, evidence_hash)` | Records an objection on-chain. Nothing moves automatically. |
| `delegate(parent, child_pubkey, child_draw_limit, child_covenant)` | Creates a child agent (see below) |

## Mandates

On the current release every outgoing payment from an agent wallet must match an owner-approved **mandate**, on top of the covenant:

- `exact`: one payment to one payee for one amount and reference. Single use, even with a different payment ID.
- `budget`: a payee list (1–16) with a per-payment cap and a total cap.
- Each grant has an intent hash, an expiry ledger and single-use payment IDs. The policy stores an on-chain receipt per payment (`get_payment`).
- Mandates intersect with the covenant; they never widen it. Returns to the pool need no mandate.

Pools created before the mandate release keep their original accounts and do not gain mandates.

## Delegation

An agent can create a **child** with a narrower covenant, carved out of its own remaining allowance:

- The child's draw limit is at most the parent's `draw_limit − drawn`, and it is deducted from the parent.
- The child's payees, calls and caps must be a subset of the parent's, and its expiry can't be later.
- Revoking a parent revokes all of its children. A parent can revoke and close its own children.
- When a child is closed, its draw limit returns to the parent, not to the pool.

## Guarantees

Each of these has a test that fails if the rule breaks:

1. The sum of active draw limits never exceeds the USDC locked in the pool.
2. No agent draws more than its draw limit.
3. A transfer is refused for: wrong asset, payee on no list, zero or negative amount, over the per-transfer cap, over the list total, after expiry, when revoked.
4. A contract call is refused if it isn't listed, exceeds its capped argument, is after expiry or the agent is revoked.
5. Only the owner can call owner functions; only the agent can call agent functions.
6. A revoked agent can't draw, and neither can its children.
7. A child covenant can't exceed its parent on any dimension.
8. Returning funds to the pool works after expiry and after revocation.
9. On current-release accounts, a payment without a valid mandate binding, over its grant, with a reused payment ID or under a revoked grant is refused, and a receipt can't exist without the transfer that produced it.

## Amounts

USDC has 7 decimals: 1 USDC = 10,000,000 base units. The contracts and the SDK use **base units**; `kovan.mjs` and the signing page take **USDC** (`"0.5"`, `"100"`).
