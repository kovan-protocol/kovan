# Kovan On-Chain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the pool, agent account, covenant policy and verifier contracts to Stellar testnet with failing-violation tests for every covenant rule.

**Architecture:** Four Soroban contracts in one Cargo workspace. `kovan-pool` holds the owner's USDC, deploys agent accounts and enforces draw limits. `kovan-agent-account` is an OpenZeppelin smart account with exactly one `Default` context rule (one External ed25519 signer + the covenant policy) and no management rule, so it is frozen at creation; its constructor grants the pool a USDC allowance so the owner can pull funds back without a signature. `kovan-covenant-policy` is the covenant: it branches on the called contract (USDC → spend rules, pool → lifecycle, wallet → reject, other → `calls` allowlist). `kovan-ed25519-verifier` is the OZ example verifier, copied.

**Tech Stack:** Rust, `soroban-sdk` 28.0.0, `stellar-accounts` 0.8.0, `stellar-contract-utils` 0.8.0, `stellar` CLI 26.1.0, target `wasm32v1-none`, `ed25519-dalek` 2.1.1 (tests only).

**Spec:** `docs/superpowers/specs/2026-10-25-kovan-covenant-design.md`

## Global Constraints

- Stellar **testnet only**. No mainnet keys, no real USDC, anywhere.
- Every commit containing AI-written code starts with `[ai]` and ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Humans generate every key with `stellar keys generate`. No task creates a key. Secrets never enter a file in the repo or an AI chat.
- Pins: `soroban-sdk = "28.0.0"`, `stellar-accounts = "0.8.0"`, `stellar-contract-utils = "0.8.0"`, `ed25519-dalek = "2.1.1"` (dev). `[profile.release] opt-level = "z"`.
- USDC has 7 decimals: $0.50 = 5_000_000, $2 = 20_000_000, $10 = 100_000_000, $50 = 500_000_000.
- Testnet USDC SAC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. Issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
- Vocabulary in code, comments and docs: pool, covenant, draw limit, providers, recipients, revoke, return funds. Never "loan", "credit", "yield", "burn".
- Tests use `e.mock_all_auths()` except where a task says otherwise. Every rule in the spec's Invariants section has a test that fails when the rule is violated.
- `stellar contract build` must run before `cargo test` in `kovan-pool`, because the pool tests import the account wasm.

## Review Focus

1. `USDC.transfer(from, to, amount)` with `to` as a **muxed** address: `Address::try_from_val` on `args[1]` fails. Expected: reject (`NotAllowed`), never panic without an error code. Test in Task 3.
2. A transfer whose `args[2]` is not an `i128` (malformed call): expected reject, not a host trap. Test in Task 3.
3. Expiry boundary: a transfer in the ledger **equal to** `expiry` is rejected (`current < expiry` is the rule). Test in Task 3.
4. `return_funds` with `amount > drawn` (agent returns earnings): `drawn` clamps to 0 and the transfer still succeeds. Test in Task 5.
5. `delegate` from an agent that already drew more than the child would need: `child.draw_limit ≤ parent.draw_limit − parent.drawn`, not `≤ parent.draw_limit`. Test in Task 7.

---

## File structure

```
kovan/
  .gitignore                      # .env, target/, node_modules/, deployments/*.local.json
  .env.example                    # names only (already in parent folder; copy)
  Makefile                        # build, test, deploy
  contracts/
    Cargo.toml                    # workspace, pins, profile.release
    ed25519-verifier/             # Task 1  (OZ example, copied)
    covenant-policy/              # Task 2, 3  (the covenant)
      src/lib.rs
      src/contract.rs             # Policy impl + admin fns
      src/covenant.rs             # types, storage, enforce logic
      src/test.rs
    agent-account/                # Task 4
      src/lib.rs, src/contract.rs, src/test.rs
    pool/                         # Task 5, 6, 7
      src/lib.rs
      src/contract.rs             # entrypoints
      src/storage.rs              # keys, AgentRecord, PoolInfo
      src/test.rs                 # unit + integration (imports account wasm)
  scripts/
    deploy.sh                     # Task 8
  deployments/
    testnet.json                  # Task 8 output (contract IDs, committed)
```

---

### Task 0: Workspace scaffold

**Files:**
- Create: `.gitignore`, `.env.example`, `Makefile`, `contracts/Cargo.toml`, `contracts/rust-toolchain.toml`

**Interfaces:**
- Produces: workspace members `ed25519-verifier`, `covenant-policy`, `agent-account`, `pool`; `make build` → `contracts/target/wasm32v1-none/release/kovan_*.wasm`; `make test`.

- [ ] **Step 1: Write `.gitignore`** with `.env`, `.env.*`, `!.env.example`, `contracts/target/`, `node_modules/`, `*.secret`.

- [ ] **Step 2: Copy `.env.example`** from `../.env.example` and add `POOL_ID=`, `POLICY_ID=`, `VERIFIER_ID=`, `ACCOUNT_WASM_HASH=`.

- [ ] **Step 3: Write `contracts/Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = ["ed25519-verifier", "covenant-policy", "agent-account", "pool"]

[workspace.package]
edition = "2021"
version = "0.1.0"
license = "MIT"

[workspace.dependencies]
soroban-sdk = "28.0.0"
stellar-accounts = "0.8.0"
stellar-contract-utils = "0.8.0"
ed25519-dalek = "2.1.1"

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

- [ ] **Step 4: Write `Makefile`** with targets `build` (`cd contracts && stellar contract build`), `test` (`build` then `cd contracts && cargo test`), `fmt`, `deploy` (`scripts/deploy.sh`).

- [ ] **Step 5: Verify** `cd contracts && cargo metadata --format-version 1 >/dev/null` succeeds once Task 1's crate exists (run after Task 1 Step 1).

- [ ] **Step 6: Commit** `[ai] scaffold contracts workspace`

---

### Task 1: Ed25519 verifier contract

**Files:**
- Create: `contracts/ed25519-verifier/Cargo.toml`, `src/lib.rs`

**Interfaces:**
- Produces: contract `Ed25519VerifierContract` implementing `stellar_accounts::verifiers::Verifier` with `KeyData = BytesN<32>`, `SigData = BytesN<64>`. Wasm: `kovan_ed25519_verifier.wasm`.

- [ ] **Step 1: Copy** `examples/multisig-smart-account/ed25519-verifier/src/contract.rs` from the OZ repo at tag v0.8.0 (local clone at `/tmp/kovan-ref/stellar-contracts`) into `src/lib.rs`. Package name `kovan-ed25519-verifier`, `crate-type = ["cdylib"]`, deps `soroban-sdk`, `stellar-accounts` from workspace.

- [ ] **Step 2: Build** `make build`. Expected: `contracts/target/wasm32v1-none/release/kovan_ed25519_verifier.wasm` exists.

- [ ] **Step 3: Commit** `[ai] add ed25519 verifier (OpenZeppelin example)`

---

### Task 2: Covenant types and storage

**Files:**
- Create: `contracts/covenant-policy/Cargo.toml`, `src/lib.rs`, `src/covenant.rs`, `src/test.rs`

**Interfaces:**
- Produces (in `covenant.rs`, all `#[contracttype]`):

```rust
pub struct CallRule { pub contract: Address, pub fn_name: Symbol, pub amount_arg: Option<u32>, pub amount_cap: i128 }

pub struct CovenantParams {
    pub pool: Address,
    pub usdc: Address,
    pub providers: Vec<Address>,
    pub provider_per_transfer_cap: i128,
    pub provider_total_cap: i128,
    pub recipients: Vec<Address>,
    pub recipient_per_transfer_cap: i128,
    pub recipient_total_cap: i128,
    pub calls: Vec<CallRule>,
    pub expiry: u32,            // ledger sequence; spend/calls refused when current >= expiry
}

pub struct CovenantState {
    pub params: CovenantParams,
    pub rule_id: u32,
    pub provider_spent: i128,
    pub recipient_spent: i128,
    pub revoked: bool,
}

pub struct Amendment {        // numeric fields only (spec: amend touches numbers)
    pub provider_per_transfer_cap: i128, pub provider_total_cap: i128,
    pub recipient_per_transfer_cap: i128, pub recipient_total_cap: i128,
    pub expiry: u32,
}

#[contracterror] #[repr(u32)]
pub enum CovenantError {
    NotInstalled = 3900, AlreadyInstalled = 3901, NotAllowed = 3902,
    WrongAsset = 3903, PayeeNotAllowed = 3904, AmountNotPositive = 3905,
    PerTransferCapExceeded = 3906, TotalCapExceeded = 3907, Expired = 3908,
    Revoked = 3909, CallNotAllowed = 3910, CallCapExceeded = 3911,
    SelfCallForbidden = 3912, NoSigner = 3913, NotPool = 3914,
}

pub enum CovenantKey { State(Address) }   // keyed by smart account address

pub fn get_state(e: &Env, account: &Address) -> CovenantState;   // panics NotInstalled
pub fn set_state(e: &Env, account: &Address, state: &CovenantState);
```

Error codes use the `39XX` range OZ reserves for third-party policies.

- [ ] **Step 1: Write failing tests** in `src/test.rs`:

```rust
#[test] fn get_state_panics_when_not_installed()  // expect CovenantError::NotInstalled
#[test] fn set_then_get_roundtrips()               // state == get_state(account)
```

- [ ] **Step 2: Run** `cargo test -p kovan-covenant-policy`. Expected: compile error (types missing).

- [ ] **Step 3: Implement** the types, `get_state`, `set_state` in `src/covenant.rs`; persistent storage, TTL extend `30*17280` with threshold `29*17280` (same constants as OZ spending-limit).

- [ ] **Step 4: Run** tests. Expected: PASS.

- [ ] **Step 5: Commit** `[ai] covenant types and storage`

---

### Task 3: Covenant enforcement (the rules)

**Files:**
- Modify: `contracts/covenant-policy/src/covenant.rs`, `src/contract.rs`, `src/test.rs`

**Interfaces:**
- Consumes: Task 2 types.
- Produces:

```rust
// covenant.rs
pub fn enforce(e: &Env, context: &Context, authenticated_signers: &Vec<Signer>, context_rule: &ContextRule, smart_account: &Address);
pub fn install(e: &Env, params: &CovenantParams, context_rule: &ContextRule, smart_account: &Address);
pub fn uninstall(e: &Env, context_rule: &ContextRule, smart_account: &Address);   // always panics NotAllowed: covenants are not removable
pub fn set_revoked(e: &Env, smart_account: &Address, revoked: bool);  // require_auth(state.params.pool)
pub fn amend(e: &Env, smart_account: &Address, a: &Amendment);        // require_auth(pool); expiry may not move earlier than current ledger

// contract.rs
#[contract] pub struct CovenantPolicyContract;
impl Policy for CovenantPolicyContract { type AccountParams = CovenantParams; ... }  // delegates to covenant::*
impl CovenantPolicyContract {
    pub fn get_covenant(e: Env, smart_account: Address) -> CovenantState;
    pub fn set_revoked(e: Env, smart_account: Address, revoked: bool);
    pub fn amend(e: Env, smart_account: Address, amendment: Amendment);
}
```

Enforcement algorithm (`enforce`), in order:
1. `smart_account.require_auth()`; if `authenticated_signers.is_empty()` → `NoSigner`.
2. Load state. If `state.revoked` → `Revoked`.
3. Match `context`: anything other than `Context::Contract` → `NotAllowed`.
4. `contract == smart_account` → `SelfCallForbidden`.
5. `contract == params.pool`: allow iff `fn_name ∈ {draw, return_funds, settle, dispute, delegate}` else `CallNotAllowed`. No expiry check (lifecycle outlives expiry).
6. `contract == params.usdc`: `fn_name != transfer` → `NotAllowed`. `args[1]` as `Address` (fail → `PayeeNotAllowed`), `args[2]` as `i128` (fail → `NotAllowed`). `amount <= 0` → `AmountNotPositive`. `current_ledger >= expiry` → `Expired`. If `to == params.pool` → allow (return path), no caps. Else pick list: providers first, then recipients; neither → `PayeeNotAllowed`. `amount > per_transfer_cap` → `PerTransferCapExceeded`; `spent + amount > total_cap` → `TotalCapExceeded`. Update `spent`, save.
7. Otherwise: `current_ledger >= expiry` → `Expired`; find `CallRule` with same `contract` and `fn_name` else `CallNotAllowed`; if `amount_arg` is `Some(i)`, `args[i]` as `i128` must satisfy `0 < v <= amount_cap` else `CallCapExceeded`.

- [ ] **Step 1: Write failing tests.** Helper `ctx(contract, fn, args) -> Context` and `install_default(e) -> (policy_client, account, params)` with providers `[prov]`, recipients `[rec]`, caps provider 2_000_000 / 5_000_000, recipient 1_000_000 / 1_000_000, one `CallRule { contract: other, fn_name: "ping", amount_arg: Some(0), amount_cap: 10 }`, expiry = current + 100. Tests (each asserts the named error via `#[should_panic(expected = "Error(Contract, #39xx)")]` or `try_` client result):

```
enforce_allows_provider_transfer_within_caps     // amount 2_000_000 → ok, provider_spent == 2_000_000
enforce_rejects_wrong_asset                      // transfer on another token → NotAllowed (contract not usdc/pool/listed → CallNotAllowed)
enforce_rejects_payee_not_listed                 // PayeeNotAllowed
enforce_rejects_zero_amount                      // AmountNotPositive
enforce_rejects_negative_amount                  // AmountNotPositive
enforce_rejects_over_per_transfer_cap            // 2_000_001 → PerTransferCapExceeded
enforce_rejects_over_total_cap                   // 2_000_000 ×3 → third → TotalCapExceeded
enforce_rejects_at_expiry_ledger                 // set ledger = expiry → Expired          (Review Focus 3)
enforce_rejects_muxed_payee                      // args[1] = MuxedAddress scval → PayeeNotAllowed (Review Focus 1)
enforce_rejects_non_i128_amount                  // args[2] = Symbol → NotAllowed         (Review Focus 2)
enforce_allows_return_to_pool_after_expiry       // to == pool, ledger > expiry → ok
enforce_rejects_approve_on_usdc                  // fn approve → NotAllowed
enforce_rejects_self_call                        // contract == account → SelfCallForbidden
enforce_allows_pool_draw                         // pool.draw → ok
enforce_rejects_pool_unknown_fn                  // pool.fund → CallNotAllowed
enforce_allows_listed_call_within_cap            // other.ping(5) → ok
enforce_rejects_listed_call_over_cap             // other.ping(11) → CallCapExceeded
enforce_rejects_unlisted_call                    // other.pong → CallNotAllowed
enforce_rejects_when_revoked                     // set_revoked(true) then transfer → Revoked
enforce_rejects_without_signers                  // empty authenticated_signers → NoSigner
set_revoked_requires_pool_auth                   // mock_auths for a non-pool address → auth error
amend_updates_caps_and_expiry                    // then transfer of new cap passes
install_twice_panics                             // AlreadyInstalled
uninstall_panics                                 // NotAllowed
```

- [ ] **Step 2: Run** `cargo test -p kovan-covenant-policy`. Expected: FAIL (functions missing).

- [ ] **Step 3: Implement** `enforce`, `install`, `uninstall`, `set_revoked`, `amend` in `covenant.rs` and the contract wrappers in `contract.rs` (mirror `examples/multisig-smart-account/spending-limit-policy/src/contract.rs`).

- [ ] **Step 4: Run** tests. Expected: all PASS.

- [ ] **Step 5: Build** `make build`. Expected: `kovan_covenant_policy.wasm` exists.

- [ ] **Step 6: Commit** `[ai] covenant policy enforcement with failing-violation tests`

---

### Task 4: Agent account (frozen smart account)

**Files:**
- Create: `contracts/agent-account/Cargo.toml`, `src/lib.rs`, `src/contract.rs`, `src/test.rs`

**Interfaces:**
- Consumes: `CovenantParams` (as `Val`), verifier address, policy address.
- Produces:

```rust
#[contract] pub struct KovanAgentAccount;
pub fn __constructor(e: &Env, agent_pubkey: BytesN<32>, verifier: Address, policy: Address, covenant: Val, pool: Address, usdc: Address);
// adds ONE rule: ContextRuleType::Default, name "covenant", valid_until None,
//   signers [Signer::External(verifier, agent_pubkey.into())], policies {policy: covenant}
// then token::Client::new(e, &usdc).approve(&self, &pool, &i128::MAX, &(current_ledger + 3_110_400))
pub fn covenant_rule_id(e: &Env) -> u32;   // returns 0
impl CustomAccountInterface { __check_auth → smart_account::do_check_auth }
impl SmartAccount for KovanAgentAccount {}  // default impls; unreachable because no rule covers self-calls
```

No `ExecutionEntryPoint`, no `Upgradeable`.

- [ ] **Step 1: Write failing tests** (`e.mock_all_auths()`; register policy + verifier natively via `e.register(...)`; USDC = `e.register_stellar_asset_contract_v2(admin)`):

```
constructor_creates_single_default_rule     // get_context_rules_count == 1; rule 0 type Default; 1 signer; 1 policy
constructor_grants_pool_allowance           // usdc.allowance(account, pool) == i128::MAX
constructor_installs_covenant               // policy.get_covenant(account).params.pool == pool
management_call_is_unauthorized             // account.add_context_rule(...) without mocks → auth failure (NotAllowed via SelfCallForbidden when routed through rule 0)
```

- [ ] **Step 2: Run** `cargo test -p kovan-agent-account`. Expected: FAIL.

- [ ] **Step 3: Implement** `contract.rs` following `examples/multisig-smart-account/account/src/contract.rs`, minus upgrade/execute, plus the `approve` call.

- [ ] **Step 4: Run** tests. Expected: PASS.

- [ ] **Step 5: Build** `make build`. Expected: `kovan_agent_account.wasm` exists. Record size; must be < 64 KiB after `opt-level = "z"`.

- [ ] **Step 6: Commit** `[ai] frozen agent account with pool allowance`

---

### Task 5: Pool core: fund, create_agent, draw, return_funds, withdraw

**Files:**
- Create: `contracts/pool/Cargo.toml`, `src/lib.rs`, `src/storage.rs`, `src/contract.rs`, `src/test.rs`

**Interfaces:**
- Consumes: `kovan_agent_account.wasm` via `contractimport!(file = "../target/wasm32v1-none/release/kovan_agent_account.wasm")` (tests upload it with `e.deployer().upload_contract_wasm`); `CovenantParams`, `Amendment` re-exported from `kovan-covenant-policy` (lib dependency, no `cdylib` conflict: policy crate sets `crate-type = ["cdylib", "rlib"]`).
- Produces (`storage.rs`):

```rust
pub enum Status { Active, SettleRequested, Revoked, Closed }
pub struct Dispute { pub by: Address, pub evidence: BytesN<32>, pub outcome: Option<u32> }
pub struct AgentRecord {
    pub covenant: CovenantParams, pub draw_limit: i128, pub drawn: i128,
    pub status: Status, pub parent: Option<Address>, pub children: Vec<Address>,
    pub dispute: Option<Dispute>,
}
pub struct PoolInfo { pub owner: Address, pub usdc: Address, pub locked: i128, pub sum_limits: i128, pub agent_count: u32 }
pub enum PoolKey { Owner, Usdc, AccountWasm, Policy, Verifier, Locked, SumLimits, Salt, Agent(Address), Agents }
#[contracterror] pub enum PoolError { NotOwner=1, NotAgent=2, NotOwnerOrParent=3, ExceedsLocked=4, ExceedsDrawLimit=5, NotActive=6, DrawnNotZero=7, ExceedsRemaining=8, BelowDrawn=9, Insufficient=10, NotActiveOrSettle=11, ChildExceedsParent=12 }
```

Produces (`contract.rs`):

```rust
pub fn __constructor(e: &Env, owner: Address, usdc: Address, account_wasm_hash: BytesN<32>, policy: Address, verifier: Address);
pub fn fund(e: &Env, amount: i128);                                   // owner auth; transfer owner→pool; locked += amount
pub fn withdraw(e: &Env, amount: i128);                               // owner; amount <= locked - sum_limits
pub fn create_agent(e: &Env, agent_pubkey: BytesN<32>, draw_limit: i128, covenant: CovenantParams) -> Address;
    // owner; sum_limits + draw_limit <= locked; covenant.pool/usdc overwritten with self/usdc;
    // deploy with salt = sha256(Salt counter) ; constructor args (pubkey, verifier, policy, covenant.into_val, self, usdc)
pub fn draw(e: &Env, agent: Address, amount: i128);                   // agent.require_auth(); Active; drawn+amount <= draw_limit; transfer pool→agent
pub fn return_funds(e: &Env, agent: Address, by: Address, amount: i128);
    // by ∈ {owner, agent}; by.require_auth(); transfer_from(spender=self, from=agent, to=self); drawn = max(0, drawn-amount)
pub fn get_agent(e: &Env, agent: Address) -> AgentRecord;
pub fn get_pool(e: &Env) -> PoolInfo;
pub fn list_agents(e: &Env) -> Vec<Address>;
```

- [ ] **Step 1: Write failing tests.** Fixture `setup() -> Fx { e, pool, usdc, owner, agent_pk, policy, verifier }`; owner minted 100_000_000 USDC; covenant params as in Task 3 fixture.

```
fund_locks_usdc                         // locked == 50_000_000; pool balance == 50_000_000
create_agent_within_locked              // returns C-address; sum_limits == 5_000_000; agent record Active
create_agent_rejects_over_locked        // draw_limit 60_000_000 → ExceedsLocked
create_agent_requires_owner             // ExceedsLocked not reached; auth failure
draw_within_limit_moves_only_bond       // draw 5_000_000 → agent balance 5_000_000, pool balance 45_000_000, drawn 5_000_000
draw_rejects_over_limit                 // 5_000_001 → ExceedsDrawLimit
draw_requires_agent_auth
return_funds_by_agent_decrements_drawn  // drawn 5_000_000 → return 2_000_000 → 3_000_000
return_funds_by_owner_without_agent_sig // mock only owner auth; pool balance up; uses allowance
return_funds_clamps_drawn_at_zero       // mint agent 1_000_000 extra; return 6_000_000 → drawn 0   (Review Focus 4)
withdraw_rejects_below_sum_limits       // Insufficient
sum_limits_le_locked_after_two_agents   // 30M + 20M ok; third 1 → ExceedsLocked
```

- [ ] **Step 2: Run** `make build && cargo test -p kovan-pool`. Expected: FAIL.

- [ ] **Step 3: Implement** storage and the seven functions. Deployment: `e.deployer().with_current_contract(salt).deploy_contract(ContractExecutable::Wasm(hash), (pubkey, verifier, policy, covenant_val, self_addr, usdc))` where `salt = e.crypto().sha256(&counter.to_xdr(e)).to_bytes()`.

- [ ] **Step 4: Run** tests. Expected: PASS.

- [ ] **Step 5: Commit** `[ai] pool: fund, create_agent, draw, return_funds, withdraw`

---

### Task 6: Pool lifecycle: revoke, amend, settle, close, dispute

**Files:**
- Modify: `contracts/pool/src/contract.rs`, `src/test.rs`

**Interfaces:**
- Consumes: Task 5 storage; policy client `set_revoked`, `amend`.
- Produces:

```rust
pub fn revoke(e: &Env, agent: Address, by: Address);        // by ∈ {owner, parent}; status Revoked; policy.set_revoked(agent,true); recurse children
pub fn amend(e: &Env, agent: Address, draw_limit: i128, amendment: Amendment);
    // owner; draw_limit >= drawn (BelowDrawn); sum_limits - old + new <= locked (ExceedsLocked); policy.amend
pub fn settle(e: &Env, agent: Address);                     // agent; Active → SettleRequested
pub fn close(e: &Env, agent: Address, by: Address);         // by ∈ {owner, parent}; drawn == 0 (DrawnNotZero); all children Closed;
    // Closed; if parent: parent.draw_limit += draw_limit else sum_limits -= draw_limit
pub fn dispute(e: &Env, agent: Address, by: Address, evidence: BytesN<32>);  // by ∈ {owner, agent}
pub fn resolve_dispute(e: &Env, agent: Address, outcome: u32);               // owner
```

- [ ] **Step 1: Write failing tests**

```
revoke_blocks_draw                        // after revoke: draw → NotActive; policy.get_covenant(agent).revoked == true
revoke_requires_owner_or_parent
amend_rejects_below_drawn                 // drawn 5M, amend to 4M → BelowDrawn
amend_rejects_over_locked
amend_updates_policy_caps                 // policy state reflects new caps
settle_then_close_requires_drawn_zero     // close with drawn>0 → DrawnNotZero; after return_funds → Closed, sum_limits decreased
dispute_records_and_owner_resolves        // record.dispute.outcome == Some(1)
return_funds_allowed_after_revoke         // owner pulls back; succeeds
```

- [ ] **Step 2: Run** tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `[ai] pool lifecycle: revoke, amend, settle, close, dispute`

---

### Task 7: Delegation

**Files:**
- Modify: `contracts/pool/src/contract.rs`, `src/test.rs`

**Interfaces:**
- Produces:

```rust
pub fn delegate(e: &Env, parent: Address, child_pubkey: BytesN<32>, child_draw_limit: i128, child_covenant: CovenantParams) -> Address;
// parent.require_auth(); parent Active;
// child_draw_limit <= parent.draw_limit - parent.drawn          (ChildExceedsParent)
// child.providers ⊆ parent.providers, child.recipients ⊆ parent.recipients, child.calls ⊆ parent.calls (by contract+fn_name)
// every child cap <= parent cap; child.expiry <= parent.expiry   (ChildExceedsParent)
// parent.draw_limit -= child_draw_limit; sum_limits unchanged
// deploy as in create_agent; child.parent = Some(parent); parent.children.push(child)
```

- [ ] **Step 1: Write failing tests**

```
delegate_carves_limit_from_parent            // parent 10M → child 4M: parent.draw_limit 6M, child 4M, sum_limits unchanged
delegate_rejects_over_parent_remaining       // parent drew 7M of 10M; child 4M → ChildExceedsParent   (Review Focus 5)
delegate_rejects_payee_not_in_parent         // child providers [x] not in parent → ChildExceedsParent
delegate_rejects_cap_above_parent
delegate_rejects_expiry_after_parent
delegate_requires_parent_auth
revoke_parent_revokes_children               // child record Revoked; child policy revoked
close_child_returns_limit_to_parent          // parent.draw_limit back to 10M
parent_can_revoke_own_child                  // by = parent
```

- [ ] **Step 2: Run** tests. Expected: FAIL.
- [ ] **Step 3: Implement** `delegate`; refactor the deploy block from `create_agent` into `fn deploy_account(e, pubkey, covenant) -> Address`.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `[ai] pool: delegate child covenants`

---

### Task 8: Testnet deployment script

**Files:**
- Create: `scripts/deploy.sh`, `deployments/testnet.json`
- Modify: `README.md` (contract ID table)

**Interfaces:**
- Consumes: wasm files; identities `kova-deployer` (owner) already present in `stellar keys`.
- Produces: `deployments/testnet.json` with `verifier`, `policy`, `account_wasm_hash`, `pool`, `usdc`, `owner`, `deployed_at`.

- [ ] **Step 1: Write `scripts/deploy.sh`** (`set -euo pipefail`, `NETWORK=testnet`, `OWNER=${OWNER:-kova-deployer}`):
  1. `make build`
  2. `stellar contract deploy --wasm …kovan_ed25519_verifier.wasm --source $OWNER --network testnet --alias kovan-verifier`
  3. same for policy, alias `kovan-policy`
  4. `stellar contract upload --wasm …kovan_agent_account.wasm …` → `ACCOUNT_WASM_HASH`
  5. `stellar contract deploy --wasm …kovan_pool.wasm … --alias kovan-pool -- --owner $(stellar keys address $OWNER) --usdc CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA --account_wasm_hash $ACCOUNT_WASM_HASH --policy $POLICY_ID --verifier $VERIFIER_ID`
  6. Write `deployments/testnet.json`; print explorer links `https://stellar.expert/explorer/testnet/contract/<id>`.

- [ ] **Step 2: Human step (not AI):** ensure `kova-deployer` is funded (`stellar keys fund kova-deployer --network testnet`) and holds testnet USDC: `stellar tx new change-trust --source-account kova-deployer --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network testnet`, then `stellar tx new path-payment-strict-receive --source-account kova-deployer --send-asset native --dest-asset USDC:GBBD47IF… --destination $(stellar keys address kova-deployer) --dest-amount 500000000 --send-max 5000000000 --network testnet`. If no path exists, ask Stellar mentors; record in README.

- [ ] **Step 3: Run** `make deploy`. Expected: four IDs printed; `deployments/testnet.json` written.

- [ ] **Step 4: Smoke on testnet:** `stellar contract invoke --id kovan-pool --source kova-deployer --network testnet -- fund --amount 50000000`, then `-- get_pool` shows `locked: 50000000`. Paste tx hashes into the README evidence table (`fund`).

- [ ] **Step 5: Commit** `[ai] testnet deploy script and deployments/testnet.json` (hashes are public; no secrets).

---

### Task 9: End-to-end wallet authorization test (signed, no mocks)

**Files:**
- Modify: `contracts/pool/src/test.rs` (or `tests/e2e.rs`)
- Dev-dep: `ed25519-dalek` (workspace)

**Interfaces:**
- Consumes: OZ test helpers from `packages/accounts/src/smart_account/test/auth_entries.rs` (`contract_fn`, `signature_payload`, `auth_entry`, `account_preimage`, `account_entry`, `external_signer`, `sign`). Copy them into the test module; attribute the source in a comment.

Purpose: prove that a real `AuthPayload` signed by the agent key passes `__check_auth` → covenant `enforce` for an allowed transfer and fails for a blocked one, without `mock_all_auths`. This is the on-chain proof the pitch rests on and the reference the TypeScript payload builder will copy.

- [ ] **Step 1: Write failing tests** (`e.set_auths(&[entry])` with `rule_id = 0`, `nonce`, expiration ledger = current + 10):

```
signed_transfer_to_provider_succeeds        // usdc.transfer(agent → prov, 1_000_000) with a valid signed entry → ok
signed_transfer_to_stranger_fails           // same signature flow, to = stranger → PayeeNotAllowed surfaced as auth error
signed_transfer_with_wrong_key_fails        // different SigningKey → ExternalVerificationFailed (3003)
signed_transfer_over_cap_fails              // 2_000_001 → PerTransferCapExceeded
```

- [ ] **Step 2: Run.** Expected: FAIL (helpers missing).
- [ ] **Step 3: Implement** helpers and tests.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `[ai] e2e: signed AuthPayload through covenant policy`

---

## Checkpoint mapping (Lisbon time)

| Checkpoint | Tasks done | Fallback |
|---|---|---|
| Sun 16:00 contracts + failing tests | 0–5 (policy rules + pool core) | Drop Task 6's `dispute`, then Task 7 (`delegate`), then `settle/close`, then `amend`. Task 3 tests are never cut. |
| Sun 18:00 | 6, 8 (deployed) | Deploy whatever compiles; IDs into README |
| Mon 01:30 | 7, 9 | Task 9 can be replaced by a testnet tx from the runtime |

## Self-review notes

- Spec coverage: draw (T5), spend (T3), calls (T3), expiry (T3), return_funds (T5), settle/close (T6), dispute (T6), delegate (T7), owner powers (T5/T6), invariants 1–8 (T3/T5/T6/T7), frozen wallet (T4), allowance path (T4/T5), verified-facts constraints (Global Constraints). Agent runtime x402 builder and dashboard: separate plans by design.
- Names used consistently: `CovenantParams`, `Amendment`, `AgentRecord`, `set_revoked`, `amend`, `return_funds(agent, by, amount)`, `revoke(agent, by)`, `close(agent, by)`.
- Open builder choices left open on purpose: exact TTL helper layout, event names, whether `list_agents` is a `Vec` in instance storage or persistent per-index.
