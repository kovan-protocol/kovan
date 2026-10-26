# Optional yield backing — pool v3

Status: **v3 code published on testnet; yield remains inactive**.
The release in `current_release` supplies v3 WASM for `New pool`, cash-only
until a vault is configured. The displayed default pool (`CBOOAYAV…CON6`,
adopted 2026-10-26) runs that v3 code with no vault configured. No matching
vault is allowlisted (`yield_vaults: []`), and no existing balances, agents,
allowances or vault positions were migrated or invested. The live mandate and
recovery rehearsals validate cash operations, not vault integration or
liquidity. This is an unaudited testnet prototype, not production investment
infrastructure. The native-vault setup tooling (`/yield/setup`,
`POST /api/yield/setup`, `prepare-yield-vault.mjs`, `register-yield-vault.mjs`)
is published in the repository; it is not exercised against any live vault.

## Native yield and existing positions

DeFindex is the first compatibility layer for both paths. **Kovan native yield**
is a Kovan-managed, single-USDC DeFindex vault connected to a lending strategy;
it is not a new lending protocol or a Kovan-funded reward rate. An **external
position** is a supported DeFindex vault's transferable shares. Both use the
existing pool contract, keep undrawn capital invested, and redeem only the cash
an agent needs. Each Kovan pool binds one vault; use separate pools for different
vault positions. Cash already advanced to an agent does not earn vault yield.

The console now lets the owner select a Kovan or external vault, instead of
silently choosing the first entry. It checks the owner's share balance when
previewing an imported position and rejects new USDC investments into a vault
without an active, funded strategy allocation. An idle vault is not advertised
as an earning source. Neither the UI nor the SDK invents an APY.

Reviewed integrations belong in `current_release.yield_vaults`. Older manifests
without that field can use top-level `yield_vaults`; an explicit empty release
list disables new deposits even if the old list contains entries. Entries use:

```ts
type YieldVault = {
  name: string;
  kind: "native" | "external"; // omitted on older entries means external
  vault: string;
  wasm_hash: string;
  usdc: string;
  strategies?: { address: string; wasm_hash: string }[];
};
```

Native entries require exactly one pinned strategy. When pins are present, the
dashboard verifies the full strategy set, executable hashes and underlying
token before new operations. Redemptions and in-kind recovery remain available
after delisting. These off-chain checks do not freeze strategy governance or
prevent a change between simulation and execution.

### Preparing a Kovan native vault

The demo includes a wallet setup page at **`/yield/setup`**, linked from the
console's yield panel. It uses the pinned XOXNO source in
`deployments/candidates/xoxno-testnet.source.json`; requests cannot substitute
another factory, strategy or token. The connected manager signs two transactions:

1. **Create and seed** an immutable DeFindex vault (default 1 test USDC, editable).
2. **Activate lending**, investing an explicit amount from that vault's idle seed.

The page saves transaction hashes before submission and can resume after a
reload. An unresolved submission blocks another creation/investment until its
hash is reconciled. A creation simulation preview never becomes a deployed vault
address. `nativeVaultFromReceipt` checks the successful factory transaction's
complete arguments, the committed return value, live vault/strategy hashes,
manager roles and fees. Receipt recovery requires the transaction to remain in
the RPC provider's history; save the creation hash when the page shows it.

After activation, the operator registers the confirmed vault locally:

```sh
node dashboard/scripts/register-yield-vault.mjs \
  --manager G_MANAGER --creation-tx CREATION_HASH --check
node dashboard/scripts/register-yield-vault.mjs \
  --manager G_MANAGER --creation-tx CREATION_HASH
```

These are placeholders for the connected manager and committed creation hash.
The command verifies provenance, ownership, exact USDC, pinned strategy and
active allocation, then appends to `current_release.yield_vaults` and records
evidence in `deployments/yield/`. It preserves other entries and refuses
conflicting entries or a concurrently changed manifest. It does not sign or
broadcast anything. An active allocation alone does not auto-register a vault.

Refresh the console, create/select a v3 pool, configure the vault **before
opening agents**, then sign an investment or lock existing shares. Keep budgets
within the discounted backing. The setup page does not migrate existing pools.

`@kovan-protocol/sdk/experimental` exposes `prepareNativeVault`,
`prepareActivateNativeVault`, `verifyYieldVault` and `inspectYieldVault`. The
operator helper returns unsigned testnet transactions for the vault manager:

```sh
cd sdk && npm run build
cd ../dashboard && npm ci --ignore-scripts
node scripts/prepare-yield-vault.mjs create --config /path/to/reviewed-source.json \
  --manager G_MANAGER --amount 10000000
# Sign the prepared XDR in the manager wallet; read the committed vault address.
node scripts/prepare-yield-vault.mjs activate --config /path/to/reviewed-source.json \
  --manager G_MANAGER --vault C_VAULT --amount 10000000
# After that transaction succeeds, verify actual strategy investment:
node scripts/prepare-yield-vault.mjs inspect --config /path/to/reviewed-source.json \
  --vault C_VAULT
```

Addresses above are placeholders. The source JSON has the `NativeYieldSource`
shape exported by the experimental SDK: `factory`, `factory_wasm_hash`,
`vault_wasm_hash`, `usdc`, `strategy: {address, wasm_hash}`, `router`, and
`max_protocol_fee_bps`. Supply reviewed on-chain values, including a strategy
whose `asset()` is Kovan's exact USDC contract. The script rejects a different
settlement asset and never signs, broadcasts or changes the manifest.

Creation uses DeFindex's `create_defindex_vault_deposit`: deployment and seeding
are atomic to protect the initial deposit. The vault is non-upgradable, has
zero Kovan vault fees, and assigns all four management roles to the named
manager. The factory's current protocol fee must be within the reviewed ceiling.
The first 1,000 base units of shares are locked by DeFindex as minimum liquidity.

**Seeding alone does not start yield.** The manager's separate `rebalance`
transaction invests an explicit amount into the pinned strategy. Later Kovan
`invest` calls follow that strategy allocation. Inspection emits a candidate
manifest entry only after it observes seeded supply and an active investment.
The strategy, its lending pool, fees and liquidity still need review. This
tooling is implemented; no compatible native vault has been activated on testnet.

### Replaying the deployed XOXNO integration locally

```sh
cd dashboard
node scripts/capture-xoxno-fork.mjs --out /tmp/kovan-xoxno-fork
cd ../contracts
stellar contract build
KOVAN_XOXNO_FORK=/tmp/kovan-xoxno-fork cargo test -p kovan-pool xoxno_deployed -- --ignored
# Also test the published pool executable captured from the current release:
KOVAN_XOXNO_FORK=/tmp/kovan-xoxno-fork \
KOVAN_XOXNO_POOL_WASM=/tmp/kovan-xoxno-fork/published-pool.wasm \
KOVAN_XOXNO_ACCOUNT_WASM=/tmp/kovan-xoxno-fork/published-account.wasm \
  cargo test -p kovan-pool xoxno_deployed -- --ignored
```

The capture performs read-only simulations and downloads their ledger footprint
and pinned WASMs. The test uses the deployed USDC, XOXNO strategy, controller,
pool and position NFT from that state, with a fresh local DeFindex vault and
Kovan pool. It verifies imported shares, an owner-authorized investment, immediate
and interest-accruing agent draws, manual redemption, and in-kind closure. The
local mint and all balance changes exist only in the test environment.

This replay uses the repository's SDK host version, not a live network commit.
RPC reads are not an atomic ledger snapshot, and the footprint capture depends
on the reference vault and current market state. A live owner-signed rehearsal
is still required before claiming a deployed end-to-end demo. Browser coverage:
`node dashboard/scripts/yield-setup-smoke.mjs` after building the dashboard.

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
  Redemption sizing reuses the pre-draw valuation within that invocation, avoiding
  a redundant traversal of the external lending strategy. Post-draw valuation
  remains fresh.
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
- **Manager decisions, underlying lending pools, oracle risks and governance are
  not pinned by executable hashes.** Optional strategy pins additionally check
  strategy code in the dashboard; the pool itself pins only the vault executable.
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

Update 2026-10-26: a broader factory scan found an exact-token **XOXNO supply
strategy** and a compatible DeFindex reference vault. A simulated investment
and unwind succeeded, but the reference vault's committed balance is entirely
idle. See [demo candidate research](YIELD_DEMO_RESEARCH.md) for verified addresses,
evidence and the proposed Kovan-managed vault setup. No vault has been activated
or allowlisted by this investigation.

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
2. Use the current published v3 release for this XOXNO demo: its pool and
   agent-account bytecode passed the local captured-state replay. The owner
   creates a fresh v3 pool in their wallet. Future contract changes require a
   separate release retaining old bindings. Existing pools are immutable.
   The historical `deploy-pool.mjs` helper does not support the current
   multi-generation manifest.
3. Add a reviewed `current_release.yield_vaults` entry to `deployments/testnet.json` with
   `{name, kind, vault, wasm_hash, usdc, strategies}`. All addresses must be actual verified testnet
   deployments; the hash is the vault executable, not the strategy hash.
4. Rebuild/publish deployment documentation and the site snapshot. The owner's
   explicit configure/invest/lock signatures are still required.
5. Rehearse small **testnet-only** deposits, actual strategy investment, both
   funding paths, signed agent draw/payment, loss/liquidity behavior and recovery.
   Local ABI tests are not a substitute for this funded integration rehearsal.

Read-only RPC checks on **2026-10-26** also checked both published USDC strategy
addresses (`CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY`
and `CDY2C6TLNPDNETNU5Z6764MJ7WXOX7EB77YGH6HT73XCWA6ANFZJDXIF`). Both
returned `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`
from `asset()`. Neither can be used to earn yield on Kovan's existing USDC.
No token swap, migration or incompatible allowlist entry was made.

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
KOVAN_DEFINDEX_WASM="$vault_test_dir/vault.wasm" cargo test -p kovan-pool published_defindex_wasm_both -- --ignored
```

For the additional native-vault test, fetch the published factory too and set
both paths. It runs the actual factory and vault bytecode with compiled Kovan
pool WASM and a local strategy fixture funded by actual token transfers:

```sh
stellar contract fetch --wasm-hash baba1e5e12e7f83b49f6f2b6b17f7bc672e38c08dca74f77d66d569c522cfec8 \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase 'Test SDF Network ; September 2015' \
  --out-file "$vault_test_dir/factory.wasm"
KOVAN_DEFINDEX_WASM="$vault_test_dir/vault.wasm" \
KOVAN_DEFINDEX_FACTORY_WASM="$vault_test_dir/factory.wasm" \
  cargo test -p kovan-pool published_defindex -- --ignored
```

The native test covers atomic creation/seeding, first strategy activation,
subsequent investment, importing shares without withdrawing the underlying,
funded strategy proceeds increasing share value without increasing agent limits,
agent redemption and in-kind recovery. Its strategy is a test fixture, not a
live Blend deployment or evidence of an actual lending return.

The test checks SHA-256 before executing the artifact. ABI source reference:
[DeFindex vault methods](https://github.com/defindex-io/stellar-contracts/blob/529f7c5006387e8c59c8d68014ff87761b8a3490/vault/src/lib.rs)
and [share transfers](https://github.com/defindex-io/stellar-contracts/blob/529f7c5006387e8c59c8d68014ff87761b8a3490/vault/src/token/contract.rs).

Run `cd sdk && npm test` for provisioning, code/asset/fee verification, allocation
readiness and registry tests. No mainnet or live yield deployment is claimed by
local tests.

Verified locally on 2026-10-26: 152 regular Rust tests, both pinned-bytecode
integration tests, 92 SDK tests, 272 dashboard tests, the dashboard production
build, and the Chromium recovery/yield smoke test at mobile and desktop widths.
The native test retains SDK per-invocation resource enforcement. Its long-lived
test host uses an unlimited bookkeeping budget to avoid an auth-snapshot shadow
budget failure; the draw additionally asserts CPU/memory below the testnet limits.
