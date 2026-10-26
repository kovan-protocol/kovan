---
title: Overview
description: What Kovan is, how the pieces fit, and where to start.
---

# Kovan docs

Kovan gives AI agents shared USDC budgets they can't overspend. An owner locks USDC in one **pool**. Each agent gets its own Stellar smart account, bound to a **covenant**: how much it may draw, which addresses it may pay, how much per payment and in total, and until when. The agent's own account enforces these rules on-chain, so a buggy, looping or prompt-injected agent can't break them.

> **Stellar testnet only.** Testnet USDC has no value. Kovan is a hackathon prototype: not audited, not a financial product.

## The three pieces

| Piece | What it is | What it enforces |
|---|---|---|
| **Pool** | A Soroban contract holding the owner's USDC | How much each agent may draw. The sum of all draw limits never exceeds what is locked. |
| **Agent wallet** | An OpenZeppelin smart account per agent, deployed by the pool | Signed by the agent's key; frozen at creation, so nobody can add a key or remove the rules |
| **Covenant policy** | The rules attached to each wallet | Who the wallet may pay, per-payment and total caps, allowed contract calls, expiry |

The owner can revoke an agent at any time and pull its funds back into the pool without the agent's signature. See [Concepts](/docs/concepts).

## Two ways to use Kovan

- **Through an agent.** Install Kovan into your agent and ask in plain words: *"Set me up a $100 pool with 2 agents."* The agent prepares every transaction with [`kovan.mjs`](/docs/agent-tool); you approve each owner action in Freighter. → [Quickstart](/docs/quickstart)
- **From your own code.** Use [`@kovan/sdk`](/docs/sdk) to create pools and agents, and to sign agent payments from your runtime.

## What runs where

- **Stellar testnet:** the pool, the agent wallets, the covenant policy and the signature verifier. See [Contracts](/docs/contracts).
- **Your machine:** your agent and `kovan.mjs`. For owner actions, `kovan.mjs` opens a small local page where you approve in **Freighter**. Your owner key never leaves your wallet.
- **Hosted, for cloud agents:** a [signing page](https://kovan-protocol.vercel.app/sign) that builds the transaction in your browser.

## Pages

- [Quickstart](/docs/quickstart): from zero to a funded pool and a working agent
- [Concepts](/docs/concepts): pools, wallets, covenants, lifecycle, guarantees
- [Agent tool](/docs/agent-tool): every `kovan.mjs` command
- [SDK](/docs/sdk): `@kovan/sdk` for TypeScript
- [Contracts](/docs/contracts): deployed IDs, functions, events, error codes
- [Paying with x402](/docs/x402): per-call payments from a smart account
- [Security model](/docs/security): what is enforced, what you trust, what's not covered

## For agents

- Agent guide: <https://kovan-protocol.vercel.app/agent.md>
- All docs as one text file: [/llms-full.txt](/llms-full.txt) · index: [/llms.txt](/llms.txt)
- Source: <https://github.com/kovan-protocol/kovan>
