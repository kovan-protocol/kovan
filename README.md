# Kovan

> **Testnet only.** Hackathon prototype on Stellar testnet. Testnet USDC has no value. Not audited. Not a financial product. Not legal advice.

HackMeridian 2026 · Lisbon · Track: Genesis + Stellar Composed ("Agents that spend")

Design: [docs/superpowers/specs/2026-10-25-kovan-covenant-design.md](docs/superpowers/specs/2026-10-25-kovan-covenant-design.md) · Plan: [docs/superpowers/plans/2026-10-25-kovan-contracts.md](docs/superpowers/plans/2026-10-25-kovan-contracts.md)

## One-liner

**Kovan gives AI agents their own on-chain spending covenant.** An owner locks USDC in a pool; each agent gets a smart account whose rules (how much it may draw, whom it may pay, what it may call, until when) are frozen at creation and enforced by the account itself. The covenant does not trust the payment rail; it trusts the allowlist.

## Problem

Agents that spend need money to spend. Today you hand the agent a funded wallet and hope, or refill it by hand. A buggy, looping or prompt-injected agent can empty whatever it holds.

## User

A developer running an agent that pays data or RPC providers per call over x402. The owner (the developer or their company) backs the agent with testnet USDC. B2B.

## Solution

1. The **owner** locks USDC in a **pool** (`fund`).
2. The pool **creates an agent**: it deploys an OpenZeppelin smart account with exactly one context rule (the agent's human-made ed25519 key + the **covenant policy**) and no management rule, so the covenant can never be changed. The account grants the pool a USDC allowance so funds can always be pulled back.
3. The agent **draws** up to its draw limit from the pool into its own account.
4. Every outgoing call from the account goes through the covenant: USDC transfers only to allowlisted **providers** (x402 or direct) and **recipients**, within per-transfer and total caps, before **expiry**; allowlisted **contract calls**; the pool's lifecycle functions. Anything else, including calls on the account itself, is rejected.
5. An agent may **delegate** a narrower covenant to a child, carved out of its own remaining allowance.
6. The owner (or a parent) can **revoke**, **amend** numeric limits, **close**, and rule on **disputes**. `return_funds` always works.

*Humans configure, agents only execute inside limits.*

## Live URL + video *(to fill during the event)*

| Item | Link |
|---|---|
| Live dashboard | TBD |
| Demo video (2–4 min) | TBD |
| Backup video (unlisted) | TBD |
| Deck | TBD |

## Architecture: how Stellar is used

| Component | Stellar feature | Contract ID (testnet) |
|---|---|---|
| `kovan-pool` | Soroban contract; USDC SAC transfers; deploys agent accounts via `deployer()` | [`CCO5PERBNCYJMOLARBNFEDJRRP7P3YZKP4PGZ4FGOPX3HCV7CZ45WIAW`](https://stellar.expert/explorer/testnet/contract/CCO5PERBNCYJMOLARBNFEDJRRP7P3YZKP4PGZ4FGOPX3HCV7CZ45WIAW) |
| `kovan-covenant-policy` | OpenZeppelin smart-account policy (`stellar-accounts` 0.8.0) | [`CDMGB5SFQD4PEVSDU6RBKJ6WCEKTWUBXCHVBABOG7NTR4KB6KJYGV6LA`](https://stellar.expert/explorer/testnet/contract/CDMGB5SFQD4PEVSDU6RBKJ6WCEKTWUBXCHVBABOG7NTR4KB6KJYGV6LA) |
| `kovan-agent-account` (per agent) | OpenZeppelin smart account, frozen at creation | wasm hash `25dabe1afc7a1ef93a0bc7b40ffa784e0a70463db91c4b1812fc155768ead2d7`; first agent [`CCUOVYCZC3DLCIL73KRJXJ4KSCM2YA3MI3T5ND43BVN4N54VKCMKJ5ZY`](https://stellar.expert/explorer/testnet/contract/CCUOVYCZC3DLCIL73KRJXJ4KSCM2YA3MI3T5ND43BVN4N54VKCMKJ5ZY) |
| `kovan-ed25519-verifier` | OZ verifier for External signers | [`CAAKLFWLG42GIS3X444MKTORXW7UTPBSGJSQEX65L23NH5G2DDWTKL6J`](https://stellar.expert/explorer/testnet/contract/CAAKLFWLG42GIS3X444MKTORXW7UTPBSGJSQEX65L23NH5G2DDWTKL6J) |
| USDC | Stellar Asset Contract | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Payments | x402 (facilitator-settled `transfer` from the agent account) | see evidence |

Full deployment record: [deployments/testnet.json](deployments/testnet.json).

### Testnet transaction evidence

| Step | What it shows | Tx |
|---|---|---|
| deploy | verifier, policy, account wasm, pool | [`93cbd8…`](https://stellar.expert/explorer/testnet/tx/93cbd835476b9a658c1427ff26e32a987bdf807afb3691b07fe84ae169a30d4e) [`8b9e05…`](https://stellar.expert/explorer/testnet/tx/8b9e05847fa14d23d16f5a3a3aca4bc173092b6ea50d0d4dac59f7d16cf8a1ae) [`55526d…`](https://stellar.expert/explorer/testnet/tx/55526d37f1cedb76b2a6e668df1aa7abef370dbdf737c6ef881a398f9aac939f) [`f4c3fe…`](https://stellar.expert/explorer/testnet/tx/f4c3fe3553a262a66a040d8266b4fdfd0127a83b64f342f32ae4ae2b7fc1ee19) |
| fund | Owner locks 5 testnet USDC in the pool | [`86dac8…`](https://stellar.expert/explorer/testnet/tx/86dac848707da290b679139600f1bccc349bbd8c5ae236c61ba4c2a5c2e047d2) |
| create agent | Pool deploys a frozen agent account ($0.50 draw limit); events show one `Default` rule with one External signer and the covenant policy, plus the USDC allowance to the pool | [`13d8ee…`](https://stellar.expert/explorer/testnet/tx/13d8ee099643cc242cdf4d77f06cdf58f0e84154714acf9cf1dd537fd813b191) |
| draw | Only the draw amount leaves the pool, into the agent account | TBD |
| x402 payment | Agent pays an allowlisted provider | TBD |
| blocked payment | Covenant rejects a payment outside the rules | TBD |
| delegate | Agent carves a child covenant | TBD |
| revoke | Owner kill switch | TBD |
| return funds | Owner pulls funds back without the agent's signature | TBD |

## Setup

```bash
rustup target add wasm32v1-none      # stellar CLI 26.1.0, cargo 1.95
make test                            # builds wasm, runs 65 tests
OWNER=<identity> make deploy         # testnet only
```

## Env vars

Names in [.env.example](.env.example). Never commit real values.

## Demo *(to fill during the event)*

Planned beats: a draw and a paid call → a blocked payment → delegation and revoke.

## Built during event vs prior work

Everything in this repo was written after Sun Oct 25 11:30 Lisbon. Before the event: planning docs only, and a throwaway x402 + smart-account proof of concept whose code was not reused.

## AI usage

AI tools were used with attribution: commits containing AI-written code start with `[ai]`. Keys and wallets were generated by humans with the Stellar CLI; no key was ever created by or shown to an AI. Design decisions were made in conversation and recorded in the design doc.

## Compliance by design

B2B, non-custodial, no return to the owner on locked funds, no token issued, no personal data on-chain. Testnet only. See the parent planning docs; not legal advice.

## Roadmap

Agent runtime with x402 payload builder for smart-account payers · dashboard · reputation (stellar-8004) · multiple pools per owner · mainnet with KYB.

## Team *(to fill during the event)*

## Testnet disclaimer

Hackathon prototype on Stellar **testnet only**. Testnet USDC has no value. Not audited. Not a financial product. Not legal advice.
