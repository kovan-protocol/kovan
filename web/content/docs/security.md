---
title: Security model
description: What Kovan enforces on-chain, what you trust, and what it does not cover.
---

# Security model

> Testnet prototype. **Not audited.** Don't use it with real funds.

## Enforced on-chain

- **Total exposure is capped.** The sum of all agents' draw limits never exceeds what the pool holds. Only drawn amounts ever leave the pool.
- **Each agent is capped.** An agent can't draw more than its limit, and its wallet can't pay anyone outside its lists, more than its caps, after expiry, or after revocation.
- **Rules can't be changed by the agent.** The wallet has one rule and no admin rule. Nobody can add a signer, change allowlists or remove the policy. The policy refuses calls on the wallet itself and `approve` / `transfer_from` on USDC, so the recovery allowance can't be abused.
- **The owner can always stop and recover.** Revoking freezes payments immediately (and the agent's children). Funds can always be returned to the pool, by the agent or by the owner without the agent's key.
- **Edge cases are tested.** Zero and negative amounts, muxed payees, non-integer arguments, the exact expiry ledger, delegation that would exceed the parent. Each rule has a test that fails if it breaks.

## What you trust

| You trust | Because |
|---|---|
| Your owner key (Freighter) | It funds the pool and approves every owner action |
| Each agent's key | Whoever holds it can spend, but only inside that agent's covenant |
| The deployed contract code | Tools pin trusted code hashes; check them against the source |
| Your RPC endpoint | Reads (balances, status) come from it; transactions are verified by the network |
| The USDC issuer | USDC's issuer can freeze accounts. While a pool, wallet or payee is frozen, transfers involving it fail. |

## Keys

- **Owner keys** stay in your wallet. `kovan.mjs` and the signing pages ask Freighter to sign; they never see your secret.
- **Agent keys** are created where the agent runs (`stellar keys generate`) and never leave it. Only the public key goes on-chain.
- Never paste a secret key into a chat, a link or a file in the repository. The signing page and `kovan.mjs` refuse secret keys where a public key belongs.

## Approving transactions

The local approval page is served by your agent, so a misbehaving agent could show misleading text there. **Freighter's own window shows the real transaction.** Check the contract, function, amounts and addresses there. `kovan.mjs` also refuses to submit anything other than the exact transaction it prepared.

## Not covered

- **Refused attempts aren't on-chain.** The covenant refuses bad payments during simulation, before anything is sent, so block explorers and chain watchers can't see them.
- **Disputes are records, not a court.** The owner rules; no funds move automatically.
- **Covenants don't judge value.** A listed provider can still overcharge within the caps. Set caps you're willing to lose.
- **Mainnet, audits and compliance onboarding** are future work.

## Reporting a problem

Open an issue on [GitHub](https://github.com/kovan-protocol/kovan/issues).
