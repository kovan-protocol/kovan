# Optional yield backing — pool v3

Status: **implemented and locally tested; not activated or deployed to testnet**.
The deployment manifest still points to the cash-only v2 pool. `New pool` uses
that deployed v2 WASM until an explicit v3 rollout. No existing balances, agents,
allowances, vault positions, or deployed contracts were changed for this feature.
This is an unaudited testnet prototype, not production investment infrastructure.

## Two entry points, one custody model

```text
Owner USDC ── fund ──> Kovan pool ── invest ──> DeFindex vault
                         ▲                       │
Owner vault shares ── lock_shares                 │ mints shares to Kovan
                         └───────────────────────┘

Agent draw: pool cash first → redeem missing cash if needed → agent smart account
Close pool: revoke/close agents → return cash AND shares in kind → original owner
```

The second path transfers **shares**, not the underlying assets. Underlying
capital remains managed by the external vault. A wallet balance or revocable
approval is not accepted as backing. The pool actually holds the shares, so the
same shares cannot simultaneously back another Kovan pool.

Only a **single-asset DeFindex vault using the pool's exact USDC address and
7-decimal transferable shares** is supported. Multi-asset vaults, nontransferable
lending positions, arbitrary DeFi protocols, cross-chain positions, and lending
against positions retained in the owner's wallet are not supported. No new
adapter contract, lending engine, mandate contract, or changes to the agent
account/policy/verifier are needed.

## Accounting and liquidity

- Liquid cash: actual USDC balance of the Kovan pool.
- Estimated external assets: the vault's fee-aware quote for the shares it holds.
- Budget backing: **90%** of that estimate, rounded down (fixed initial 10% buffer).
- `locked = cash + outstanding agent advances + budget_backing`.
- New/increased budgets and owner cash withdrawals must remain fully backed.
- Agent draws check solvency before and after execution. They use existing cash
  first, then at most one redemption for the missing amount, rounding shares up.
  Actual received USDC and shares burned are checked; an error reverts the entire
  draw, including accounting and external-contract effects.
- Available withdrawal shown in the console is bounded by **cash**, never by NAV
  alone. Manual redemption returns cash to the pool, not directly to the owner.
- Investment is manual, owner-signed and opt-in. The owner chooses how much cash
  to leave liquid. Returned agent funds are not automatically reinvested.
- Gains do not automatically expand agent limits. Losses can reduce backing below
  existing commitments; further draws freeze until top-up/reduced allocations or
  recovery. Reducing limits remains possible while underfunded.

The buffer is **not insurance**. It does not guarantee principal, redemption
liquidity, a return rate, or continuous agent payments. Funds already advanced
to agents no longer earn vault yield through this pool. Vault deposits may remain
idle according to the vault's allocations even when `invest=true` is requested.

## Contract interface

Constructor remains `(owner, usdc, account_wasm_hash, policy, verifier)`, cash-only
by default. `get_pool.accounting_version` is 3 for the new source/WASM.

| Owner-signed entry point | Effect |
| --- | --- |
| `configure_yield(vault, wasm_hash)` | One-time binding, only with no open agents; verifies current executable, asset and share decimals. No funds move. |
| `invest(amount, min_shares, valid_until)` | Deposits pool USDC into the bound vault; measures actual cash/share deltas and preserves backing. |
| `lock_shares(shares, min_assets, valid_until)` | Transfers existing owner shares to the pool; checks their current underlying quote against the minimum. |
| `redeem_shares(shares, min_assets, valid_until)` | Redeems to pool cash; verifies actual output and remaining backing. |
| `release_shares(shares)` | Returns shares to the original owner in kind, only after all agents/commitments close. Also handles late share refunds after shutdown. |
| `close_pool()` | Existing permanent shutdown, additionally returns all bound-vault shares in kind before refunding cash. Atomic: a failed transfer rolls back closure. |

`get_yield()` reports shares, their estimated asset value, discounted backing,
and explicit `valuation_ok`/`share_balance_ok` flags. A failed quote or changed
vault code contributes **zero yield backing**, not a stale cached estimate.
The console does not display an unknown share balance as zero. Fully cash-backed
draws and owner funding can continue without a quote. Agent revocation, closure
and in-kind recovery do not depend on a successful NAV quote or redemption.

## Trust boundaries and recovery

- The **on-chain pool owner** chooses and trusts one vault address/code hash.
  This is a per-owner trust decision, not an on-chain protocol-wide approved list.
  Direct contract callers can opt into a malicious provider and lose their own
  backing; the interface checks do not certify a vault's safety.
- The dashboard additionally requires an explicitly reviewed deployment allowlist
  for configuration, investments, and share locking. The list is empty by default.
- Vault code is pinned per pool and cannot be replaced. A code change stops new
  yield operations; normal reads will not execute unreviewed replacement code.
- **Strategy code, manager decisions, underlying lending pools, oracle risks and
  governance are not pinned by the vault executable hash.** Review them separately.
- Investments authorize only the exact nested USDC transfer to the bound vault.
  No unlimited allowance, arbitrary recipient, or caller-selected external call
  is exposed to an agent. Existing covenant spending checks remain unchanged.
- Quote previews use a 0.5% minimum-output tolerance and a 60-ledger deadline;
  owner transactions are re-simulated and signed in Freighter. Contract callers
  supply their own explicit bounds. APY is not fabricated or advertised.
- In a pause/loss incident, stop agents, recover/close their allocations, and
  return shares **in kind**. This does not require redeeming underlying assets.
- In-kind recovery still depends on the vault's share transfer working. It
  intentionally calls the current vault even after a code change, at the owner's
  request. If transfers fail, cash can still be withdrawn after commitments close;
  the pool is not falsely marked closed. A hostile/broken vault can strand shares.
- Agent USDC recovery still has the existing finite token allowance/TTL constraints.
  Underlying asset issuer freezes/clawbacks and vault/strategy archival remain risks.

## Why live activation is gated

On 2026-10-25, read-only RPC checks of the
[published DeFindex testnet vault](https://github.com/defindex-io/stellar-contracts/blob/529f7c5006387e8c59c8d68014ff87761b8a3490/public/testnet.contracts.json)
confirmed:

| Item | Verified value |
| --- | --- |
| DeFindex vault | `CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN` |
| Executable SHA-256 | `f345228dca59c6605789620e9ec62ff4847a0927c33dac7581a955fe746016be` |
| Vault's underlying asset | `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU` |
| Kovan's current USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Those are **different assets**. The published vault was not allowlisted. Do not
silently swap Kovan's USDC or route existing balances to that vault. Activation
needs a reviewed, seeded vault/strategy accepting Kovan's exact token (or a
separately approved change of asset across the product, which is out of scope).

Once a compatible provider is chosen and reviewed:

1. Re-run the tests and review fee, manager, strategy, upgrade and liquidity risks.
2. Deploy fresh v3 pools using the pool-only rollout helper; never upgrade/drain
   the immutable older pools. `make deploy` changes the deployment manifest;
   `node scripts/deploy-pool.mjs --check` from `dashboard/` is read-only.
3. Add a reviewed `yield_vaults` entry to `deployments/testnet.json` with
   `{name, vault, wasm_hash, usdc}`. All addresses must be actual verified testnet
   deployments; the hash is the vault executable, not the strategy hash.
4. Rebuild/publish deployment documentation and the site snapshot. The owner's
   explicit configure/invest/lock signatures are still required.
5. Rehearse small **testnet-only** deposits, actual strategy investment, both
   funding paths, signed agent draw/payment, loss/liquidity behavior and recovery.
   Local ABI tests are not a substitute for this funded integration rehearsal.

## Verification

Run `make test`, then `cd dashboard && npm test && npm run build`.
`node scripts/recovery-smoke.mjs` exercises mocked wallet/API flows in Chromium,
including yield previews, rejection/retry, both funding paths and in-kind recovery.
No browser smoke-test transaction is broadcast.

The separate local ABI test runs the **compiled Kovan pool WASM against actual
published vault bytecode**, initialized
with a local test asset and no strategies. It verifies real share minting/burning,
minimum-liquidity lock, nested authorization, quotes and recovery, not live Blend
liquidity or yield generation. It is ignored in the default suite to avoid a
network/download dependency. Download and verify the artifact, then run it:

```sh
vault_test_dir=$(mktemp -d /tmp/kovan-defindex-test.XXXXXX)
stellar contract fetch --wasm-hash f345228dca59c6605789620e9ec62ff4847a0927c33dac7581a955fe746016be \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase 'Test SDF Network ; September 2015' \
  --out-file "$vault_test_dir/vault.wasm"
cd contracts
KOVAN_DEFINDEX_WASM="$vault_test_dir/vault.wasm" cargo test -p kovan-pool published_defindex -- --ignored
```

The test checks SHA-256 before executing the artifact. ABI source reference:
[DeFindex vault methods](https://github.com/defindex-io/stellar-contracts/blob/529f7c5006387e8c59c8d68014ff87761b8a3490/vault/src/lib.rs)
and [share transfers](https://github.com/defindex-io/stellar-contracts/blob/529f7c5006387e8c59c8d68014ff87761b8a3490/vault/src/token/contract.rs).

Local verification: 132 regular Rust tests + 144 dashboard tests, plus the
separately executed pinned-bytecode integration test. No mainnet or live yield
deployment is claimed by these results.
