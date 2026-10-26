# Testnet yield candidate — 2026-10-26

**Recommended next demo integration: a Kovan-managed DeFindex vault using the
deployed XOXNO USDC supply strategy below.** It accepts Kovan's existing Circle
testnet USDC. No asset migration or new adapter interface is needed.

This is a compatibility investigation, not an activation or security audit.
The existing third-party vault is idle and is not ready for Kovan's active-yield
allowlist. No transactions were signed or broadcast during this investigation.

Implementation follow-up: `/yield/setup` now provides wallet-signed creation,
seed investment and receipt recovery, with a separate operator registration
command. A local replay using captured deployed XOXNO state passed both funding
paths, immediate and interest-accruing agent draws, redemption and in-kind
closure. See [setup and replay instructions](YIELD.md). This is local evidence;
a Kovan-managed vault has not yet been created or activated on the public chain.

## Verified addresses

| Component | Testnet address / SHA-256 |
| --- | --- |
| USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| XOXNO strategy | `CCRU56E3WHFFGEQ7LZ4HEEL6MWVZE7BBHB36H4F6Y27T6GGY4SCR2FMM` |
| Strategy WASM | `76c696dd08b0f02f47064d0a45057a80eaf424a05e4c1361b91fc61d01d4c7f4` |
| Existing reference vault, TM Circle | `CBCTPTAL7E54BCDYO54GJUNM7GLEPL3UXAF6HEGWMM2MTXLFVJ7NCNSZ` |
| Vault WASM | `f345228dca59c6605789620e9ec62ff4847a0927c33dac7581a955fe746016be` |
| DeFindex factory | `CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32` |
| XOXNO controller | `CCXRWJ6SIU2WPFEGLFGJVITPL57QAYIMIO6OAM2NBGNDQSSCK2FFV3F3` |
| XOXNO lending pool | `CBSGF6QOQAMPFBEVSYPEQHSZRIHJ6RCGUPCRDMUX36DEKRWFAO2PZB5A` |

The deployed strategy's instance storage selects hub 1, spoke 1, and the exact
USDC above. Its controller, pool and position NFT match XOXNO's
[published testnet configuration](https://github.com/XOXNO/rs-lending-xlm/blob/30d599055741c426af984d9c9c9c35f3101f1509/configs/networks.json).
XOXNO describes the [DeFindex adapter](https://github.com/XOXNO/rs-lending-xlm/blob/30d599055741c426af984d9c9c9c35f3101f1509/contracts/defindex-strategy/README.md)
as one lending account per vault, with deposits supplying collateral and
withdrawals returning it. Interest accrues through the lending supply index.
The current source was consulted for architecture; its reproducible-build
equivalence to the deployed strategy hash has not been established.

## Live RPC evidence

Reads and simulations used `https://soroban-testnet.stellar.org` around
10:02–10:06 UTC on 2026-10-26. Amounts in the evidence JSON are integer base units.

- The reference vault has one asset, 7-decimal shares, the expected DeFindex
  executable, an unpaused strategy, and `Upgradable = false`.
- Its balance was **500.0001 test USDC, all idle**. It therefore fails Kovan's
  `hasActiveAllocation` check until its manager invests. Kovan does not control
  that manager; use a new Kovan-managed vault to avoid this dependency.
- A single simulated `rebalance([Invest(strategy, 10000000),
  Unwind(strategy, 10000000)])` succeeded at ledger **5397104**. Events show
  **1.0000000 USDC supplied and 0.9999999 USDC returned**, a one-base-unit
  rounding loss. This exercised the deployed vault, strategy, controller and
  lending pool without committing state. It used 25,289,917 instructions.
- The USDC market reports nonzero borrowing and a supply index above its initial
  value. Available market cash was approximately **837.70 test USDC**. This is
  a lending-backed route; no APY is inferred or promised from this snapshot.
- The reference vault's vault fee was zero. Its protocol fee parameter was
  2,000 basis points of vault fees, not a 20% principal withdrawal charge.

This does not yet prove the complete Kovan `invest → agent draw → redeem` flow,
future liquidity, or position transfers under a new vault. Those need a small
testnet rehearsal after creation and activation. Controller/pool governance
remains mutable even when the vault and strategy hashes are pinned.

## Search coverage and alternatives

Enumerated all 288 indices in the published DeFindex factory. `get_assets`
succeeded for 286; two contracts returned `WasmVm/MissingValue`. Found 27
single-asset vaults matching Kovan's exact USDC, nine with a configured strategy.
This covers that factory's registry, not every vault on Stellar.

| Candidate | Finding |
| --- | --- |
| XOXNO / TM Circle, index 272 | Preferred lending strategy; investment and unwind simulation passed. Existing vault needs manager activation. |
| Vyn / FixApr, index 165 | Exact token and 11.7338806 USDC allocated; strategy holds 19.5 USDC. Fixed-rate test strategy, not established lending yield. Manager held no shares, so the attempted manager share withdrawal failed; no successful holder redemption is claimed. |
| Kumbara / Hodl, indices 225 and 227 | Compatible token and shares, but holding tokens alone creates no native yield. |
| Vanity and Trinqa variants | Empty, paused, minimal investment or fixed-APR test setups; less suitable for demonstrating lending-backed yield. |

The published Blend strategies still accept a different mock USDC contract.
The [fixed-APR reference implementation](https://github.com/defindex-io/stellar-contracts/blob/529f7c5006387e8c59c8d68014ff87761b8a3490/strategies/fixed_apr/src/lib.rs)
credits calculated rewards but does not lend capital to an external market;
it needs token funding to make those rewards withdrawable. It is unsuitable
for presenting an organic lending return.

## Concrete next step

Use [the candidate source configuration](../deployments/candidates/xoxno-testnet.source.json)
with the existing unsigned native-vault preparation workflow in [YIELD.md](YIELD.md).
Create and seed a new immutable Kovan vault, invest the seed, verify its active
allocation, then rehearse small deposits, share locking and agent redemption.
Only the resulting verified vault belongs in `current_release.yield_vaults`.
The candidate configuration is not loaded by the application or its allowlist.

[Recorded RPC evidence](../deployments/research/yield-testnet-2026-10-26.json)
contains the scan counts, strategy candidates, live instance configuration,
decoded round-trip events and market snapshot. Refresh these checks before use.
