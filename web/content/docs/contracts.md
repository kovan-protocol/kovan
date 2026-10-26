---
title: Contracts
description: Deployed testnet IDs, pool functions, events and every error code.
---

# Contracts

Four Soroban contracts, written in Rust with `soroban-sdk` 28 and OpenZeppelin `stellar-accounts` 0.8.0. Source: [`contracts/`](https://github.com/kovan-protocol/kovan/tree/main/contracts).

## Deployed on testnet

Latest release, published 2026-10-26: native mandate v1, recovery v1, accounting v3. `New pool` uses these artifacts through the owner's wallet. No existing agents or funds are migrated.

The current default is [`CBOOAYAVDNAKBAH2OE57O4FDQW4OKCTDJDNJ6MGYM5AP2L46VTGBCON6`](https://stellar.expert/explorer/testnet/contract/CBOOAYAVDNAKBAH2OE57O4FDQW4OKCTDJDNJ6MGYM5AP2L46VTGBCON6), deployed empty on 2026-10-26 at 10:35:47 UTC ([transaction](https://stellar.expert/explorer/testnet/tx/df2e7860fa1c6fee39625563ae3c51a22e5ec2c0bd52e9fa719788b1a0c8e28a)). The original `GCNN…HBOC` wallet is still its owner. At the user's request, the dedicated testnet deployer paid its creation fee; no owner key was used and no old funds were moved. The previous default had 0 USDC and no agents.

| New artifact | ID / hash |
| --- | --- |
| Covenant policy | `CA2NXNPDGZ674K467K3K2IXV342BTPJ7YJRLVZPT4LCSJS5GHLVSMEN7` |
| Pool WASM | `857f3a27fda736f842e5b4c548022a05197137650cc49f984dde141287175dc1` |
| Agent-account WASM | `909b66bf67a425308f832ceadc4aa49ef5862ce256533cec3b8a9e4fdab6ccf4` |

The verifier and USDC below are reused. The following bindings describe the **previous default**, retained for history, not the current default or new creation:

| Contract | ID / hash |
|---|---|
| Pool (v2, previous default) | [`CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR`](https://stellar.expert/explorer/testnet/contract/CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR) |
| Pool code (wasm hash) | `cc1aadcf38ffeee5d15717e04f48f325024b7a47e57ca1548a8e9d49b731b464` |
| Covenant policy | [`CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2`](https://stellar.expert/explorer/testnet/contract/CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2) |
| ed25519 verifier | [`CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4`](https://stellar.expert/explorer/testnet/contract/CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4) |
| Agent account code (wasm hash) | `25dabe1afc7a1ef93a0bc7b40ffa784e0a70463db91c4b1812fc155768ead2d7` |
| USDC (Stellar Asset Contract) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |

Anyone can deploy their own pool from the published pool code (`kovan.mjs owner create_pool` or `kovan.prepareCreatePool`). The source of truth for these values is [`deployments/testnet.json`](https://github.com/kovan-protocol/kovan/blob/main/deployments/testnet.json); they change if the network resets.

## The four contracts

| Contract | Role |
|---|---|
| `kovan-pool` | Holds USDC, deploys agent wallets, enforces draw limits and the lifecycle. One per owner (or more). |
| `kovan-agent-account` | The agent's wallet: an OpenZeppelin smart account with one rule and no admin rule. One per agent. |
| `kovan-covenant-policy` | The covenant, as an OpenZeppelin policy. Shared by all wallets; state is keyed by wallet address. |
| `kovan-ed25519-verifier` | Verifies agent signatures. Copied from the OpenZeppelin example; shared. |

The policy is a separate contract from the pool on purpose: Soroban forbids re-entering a contract. When an agent calls the pool, the pool asks the wallet to authorize, and the wallet asks its policy. If the policy were the pool, that would re-enter the pool.

## Pool functions

| Function | Caller | Effect |
|---|---|---|
| `fund(amount)` | owner | Lock USDC |
| `withdraw(amount)` | owner | Take back USDC no draw limit backs |
| `create_agent(agent_pubkey, draw_limit, covenant) → Address` | owner | Deploy an agent wallet with its covenant |
| `amend(agent, draw_limit, amendment)` | owner | Change numeric caps and expiry |
| `revoke(agent, by)` | owner or parent | Freeze payments and calls (recursive to children) |
| `close(agent, by)` | owner or parent | Recover the wallet's balance, settle what was spent, release the draw limit |
| `return_funds(agent, by, amount)` | agent or owner | Move USDC from the wallet back to the pool |
| `close_pool()` | owner | Permanent; all agents must be closed |
| `draw(agent, amount)` | agent | Pool → wallet, within the draw limit |
| `settle(agent)` | agent | Request closure |
| `dispute(agent, by, evidence)` / `resolve_dispute(agent, outcome)` | agent or owner / owner | Record an objection / the owner's ruling |
| `delegate(parent, child_pubkey, child_draw_limit, child_covenant) → Address` | agent | Create a narrower child agent |
| `get_pool()`, `get_agent(agent)`, `list_agents()` | anyone | Read state |
| `get_config()`, `mandate_version()` | anyone | New release: immutable constructor bindings / native mandate capability |
| `create_mandate(agent, params)` | original owner | New release: approve immutable exact or budget grant |
| `revoke_mandate(agent, id)` | original owner | New release: terminal grant revocation |
| `get_mandate(agent, id)`, `get_payment(agent, payment_id)` | anyone | New release: read grant / durable payment receipt |

The published v3 code includes experimental optional-yield functions, but no matching vault is enabled. Pools start cash-only; publication does not activate yield.

Recovery v1 renews the fixed pool/token allowance before recovering an agent's balance, including after its previous 3,000,000-ledger allowance has expired. Only the bound pool can renew it; no signer, policy or arbitrary spender can be added. The new delegation limits are 16 direct children, depth 4 (root is depth 0), and 17 agents per root family over its lifetime. Closed descendants still count so recursive revocation remains bounded. Older immutable releases do not acquire these fixes.

Native mandates are owner-approved exact-transfer or budget grants with intent hashes and deadlines. New account authorization binds mandate ID, single-use payment ID, purchase reference and expiry. The policy enforces both grant and covenant, recording a receipt atomically with payment. Returns to the pool do not require a grant. Generic calls retain covenant checks; native mandates do not implement AP2 credentials, remote task execution or delivery verification. Legacy pools do not acquire these rules.

### Covenant parameters

```text
CovenantParams {
  pool, usdc,                                   // set by the pool, not the caller
  providers: Vec<Address>, provider_per_transfer_cap: i128, provider_total_cap: i128,
  recipients: Vec<Address>, recipient_per_transfer_cap: i128, recipient_total_cap: i128,
  calls: Vec<{ contract, fn_name, amount_arg: Option<u32>, amount_cap: i128 }>,
  expiry: u32,                                  // ledger sequence
}
```

## Events

The pool publishes one event per state change. Use Stellar RPC `getEvents` on the pool's contract ID to follow it.

| Event | Fields |
|---|---|
| `Funded` | amount, locked |
| `Withdrawn` | amount, locked |
| `AgentCreated` | agent, draw_limit |
| `Drawn` | agent, amount, drawn |
| `Returned` | agent, by, amount |
| `Revoked` | agent, by |
| `Amended` | agent, draw_limit |
| `SettlementRequested` | agent |
| `Closed` | agent, recovered, consumed |
| `Delegated` | parent, child, draw_limit |
| `PoolClosed` | owner, returned |

Agent payments appear as USDC `transfer` events from the agent's wallet address.

The new **policy** also emits `MandateCreated` (agent, mandate ID, params), `MandateRevoked` (agent, mandate ID), and `MandatePayment` (agent, payment ID, receipt). Query the selected pool's policy, not a global latest policy when viewing an old pool.

## Error codes

Errors appear as `Error(Contract, #N)`. The SDK and `kovan.mjs` add the name, e.g. `#3904 PayeeNotAllowed`.

### Pool

| # | Name | Meaning |
|---|---|---|
| 1 | `NotOwner` | Caller isn't the pool owner |
| 3 | `NotOwnerOrParent` | Caller is neither the owner nor the agent's parent |
| 4 | `ExceedsLocked` | Total draw limits would exceed locked USDC |
| 5 | `ExceedsDrawLimit` | Draw over the agent's remaining limit |
| 6 | `NotActive` | Agent is revoked or closed |
| 7 | `DrawnNotZero` | Can't close: drawn funds are still out |
| 9 | `BelowDrawn` | New draw limit is below what was already drawn |
| 10 | `Insufficient` | Withdrawal exceeds unassigned USDC |
| 11 | `NotActiveOrSettle` | A child is still open, or there's no dispute to resolve |
| 12 | `ChildExceedsParent` | Child covenant exceeds its parent on some dimension |
| 13 | `AmountNotPositive` | Amount must be above 0 |
| 14 | `UnknownAgent` | No such agent in this pool |
| 15 | `TooManyChildren` | Parent already has 16 children |
| 16 | `Expired` | The agent's covenant has expired |
| 17 | `PoolClosed` | The pool is permanently closed |
| 18 | `PoolNotEmpty` | Can't close the pool while agents are open |
| 29 | `TooManyDescendants` | Root family already contains 17 lifetime agents |
| 30 | `DelegationTooDeep` | Child would exceed depth 4, counting the root as 0 |

Codes 2 and 8 are reserved; 19–27 belong to v3 yield operations. `28 UnsupportedMandate` refuses grants for agents without the new capability.

### Covenant policy

| # | Name | Meaning |
|---|---|---|
| 3900 | `NotInstalled` | Wallet has no covenant |
| 3901 | `AlreadyInstalled` | A covenant is written once |
| 3902 | `NotAllowed` | Action not allowed (e.g. `approve` on USDC, malformed call, uninstall) |
| 3903 | `WrongAsset` | Not the covenant's USDC |
| 3904 | `PayeeNotAllowed` | Payee isn't on the providers or recipients list |
| 3905 | `AmountNotPositive` | Amount must be above 0 |
| 3906 | `PerTransferCapExceeded` | Over the per-payment cap |
| 3907 | `TotalCapExceeded` | Over the list's total cap |
| 3908 | `Expired` | Covenant has expired |
| 3909 | `Revoked` | Owner revoked the agent |
| 3910 | `CallNotAllowed` | Contract call isn't on the allowlist |
| 3911 | `CallCapExceeded` | Capped argument too high |
| 3912 | `SelfCallForbidden` | The wallet can't call itself |
| 3913 | `NoSigner` | No authenticated signer |
| 3914 | `NotPool` | Reserved (revoke and amend on the policy already require the pool's authorization) |
| 3915 | `MandateRequired` | New outgoing payment lacks a grant envelope |
| 3916 | `MandateInvalid` | Invalid grant or payment binding |
| 3917 | `MandateExists` | Grant ID cannot be replaced |
| 3918 | `MandateMissing` | Unknown grant |
| 3919 | `MandateRevoked` | Grant permanently revoked |
| 3920 | `MandateExceeded` | Grant budget exhausted |
| 3921 | `PaymentConsumed` | Payment ID already used, even under another grant |
| 3922 | `PaymentMismatch` | Payment differs from the authorized scope |

### Smart account (OpenZeppelin, 3000–3018)

Raised by the wallet itself, e.g. `3002 UnvalidatedContext` (no rule matched), `3003 ExternalVerificationFailed` (bad signature), `3016 UnauthorizedSigner`. Full list in the [OpenZeppelin stellar-contracts](https://github.com/OpenZeppelin/stellar-contracts) source.

## Build and test

```bash
cd contracts && stellar contract build && cargo test   # target wasm32v1-none
```
