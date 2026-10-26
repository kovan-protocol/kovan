//! Opt-in, single-asset DeFindex adapter. No lending engine, oracle or standing allowance.
//! ABI reference: defindex-io/stellar-contracts @ 529f7c5006387e8c59c8d68014ff87761b8a3490.
//! Vault shares are held by THIS pool. A quote is backing, never a liquidity guarantee.
use crate::storage::{self as st, PoolError, PoolKey};
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contractclient, contractevent, contracttype, panic_with_error, symbol_short, token, vec,
    Address, BytesN, Env, Executable, IntoVal, String, Symbol, Val, Vec,
};

/// Initial risk buffer, not insurance. Losses beyond this can undercollateralize budgets.
pub const BACKING_BPS: i128 = 9_000;

#[contracttype]
#[derive(Clone)]
pub struct Strategy {
    pub address: Address,
    pub name: String,
    pub paused: bool,
}
#[contracttype]
#[derive(Clone)]
pub struct AssetStrategySet {
    pub address: Address,
    pub strategies: Vec<Strategy>,
}

#[contractclient(name = "VaultClient")]
pub trait Vault {
    fn get_assets(e: &Env) -> Vec<AssetStrategySet>;
    fn get_asset_amounts_per_shares(e: &Env, vault_shares: i128) -> Vec<i128>;
    // Ignore the provider-specific investment-allocation return, verify balance deltas instead.
    fn deposit(
        e: &Env,
        amounts_desired: Vec<i128>,
        amounts_min: Vec<i128>,
        from: Address,
        invest: bool,
    ) -> Val;
    fn withdraw(
        e: &Env,
        withdraw_shares: i128,
        min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128>;
}

#[contracttype]
#[derive(Clone)]
pub struct YieldConfig {
    pub vault: Address,
    pub wasm_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct YieldInfo {
    pub vault: Option<Address>,
    pub shares: i128,
    pub share_balance_ok: bool,
    pub share_decimals: u32,
    pub estimated_assets: i128,
    pub budget_backing: i128,
    pub backing_bps: u32,
    /// False means no yield value may be used to authorize budgets or withdrawals.
    pub valuation_ok: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct YieldConfigured {
    #[topic]
    pub vault: Address,
    pub wasm_hash: BytesN<32>,
}
#[contractevent]
#[derive(Clone)]
pub struct YieldMovement {
    #[topic]
    pub vault: Address,
    #[topic]
    pub action: Symbol,
    pub shares: i128,
    pub assets: i128,
}

pub fn config(e: &Env) -> Option<YieldConfig> {
    e.storage().instance().get(&PoolKey::YieldConfig)
}
fn required(e: &Env) -> YieldConfig {
    config(e).unwrap_or_else(|| panic_with_error!(e, PoolError::YieldNotConfigured))
}
fn cash(e: &Env) -> token::TokenClient<'_> {
    token::TokenClient::new(e, &st::get_address(e, PoolKey::Usdc))
}
fn matches_code(c: &YieldConfig) -> bool {
    c.vault.executable() == Some(Executable::Wasm(c.wasm_hash.clone()))
}
fn checked(e: &Env) -> YieldConfig {
    let c = required(e);
    if !matches_code(&c) {
        panic_with_error!(e, PoolError::YieldCodeChanged);
    }
    c
}
fn positive(e: &Env, n: i128) {
    if n <= 0 {
        panic_with_error!(e, PoolError::AmountNotPositive);
    }
}
fn deadline(e: &Env, ledger: u32) {
    if e.ledger().sequence() > ledger {
        panic_with_error!(e, PoolError::YieldQuoteExpired);
    }
}
fn math(e: &Env, n: Option<i128>) -> i128 {
    n.unwrap_or_else(|| panic_with_error!(e, PoolError::YieldArithmetic))
}
fn quote(e: &Env, c: &YieldConfig, shares: i128) -> i128 {
    if shares == 0 {
        return 0;
    }
    let values = VaultClient::new(e, &c.vault).get_asset_amounts_per_shares(&shares);
    if values.len() != 1 || values.get_unchecked(0) < 0 {
        panic_with_error!(e, PoolError::YieldInvalidVault);
    }
    values.get_unchecked(0)
}

/// Owner opts in once, before agents exist. Address + executable are immutable per pool.
/// The owner trusts the vault and its strategies; code pinning is NOT strategy/governance pinning.
pub fn configure(e: &Env, vault: Address, wasm_hash: BytesN<32>) {
    if config(e).is_some() {
        panic_with_error!(e, PoolError::YieldAlreadyConfigured);
    }
    if st::get_i128(e, PoolKey::OpenAgents) != 0 {
        panic_with_error!(e, PoolError::PoolNotEmpty);
    }
    let c = YieldConfig { vault, wasm_hash };
    if !matches_code(&c) {
        panic_with_error!(e, PoolError::YieldCodeChanged);
    }
    let assets = VaultClient::new(e, &c.vault).get_assets();
    if assets.len() != 1
        || assets.get_unchecked(0).address != st::get_address(e, PoolKey::Usdc)
        || token::TokenClient::new(e, &c.vault).decimals() != 7
    {
        panic_with_error!(e, PoolError::YieldInvalidVault);
    }
    e.storage().instance().set(&PoolKey::YieldConfig, &c);
    YieldConfigured {
        vault: c.vault,
        wasm_hash: c.wasm_hash,
    }
    .publish(e);
}

/// Best-effort read: provider failures must not hide the owner, cash, or recovery controls.
/// Zero backing on failure; callers may still use fully cash-backed budgets.
pub fn info(e: &Env) -> YieldInfo {
    let mut out = YieldInfo {
        vault: None,
        shares: 0,
        share_balance_ok: true,
        share_decimals: 7,
        estimated_assets: 0,
        budget_backing: 0,
        backing_bps: BACKING_BPS as u32,
        valuation_ok: true,
    };
    let Some(c) = config(e) else {
        return out;
    };
    out.vault = Some(c.vault.clone());
    out.valuation_ok = false;
    out.share_balance_ok = false;
    // Do not execute an unreviewed replacement merely to render the pool dashboard.
    if !matches_code(&c) {
        return out;
    }
    let Ok(Ok(shares)) =
        token::TokenClient::new(e, &c.vault).try_balance(&e.current_contract_address())
    else {
        return out;
    };
    if shares < 0 {
        return out;
    }
    out.shares = shares;
    out.share_balance_ok = true;
    if shares == 0 {
        out.valuation_ok = true;
        return out;
    }
    let Ok(Ok(values)) = VaultClient::new(e, &c.vault).try_get_asset_amounts_per_shares(&shares)
    else {
        return out;
    };
    if values.len() != 1 {
        return out;
    }
    let value = values.get_unchecked(0);
    if value < 0 {
        return out;
    }
    let Some(backing) = value.checked_mul(BACKING_BPS).map(|n| n / 10_000) else {
        return out;
    };
    out.estimated_assets = value;
    out.budget_backing = backing;
    out.valuation_ok = true;
    out
}

pub fn accounted(e: &Env) -> i128 {
    math(
        e,
        cash(e)
            .balance(&e.current_contract_address())
            .checked_add(st::get_i128(e, PoolKey::Outstanding))
            .and_then(|n| n.checked_add(info(e).budget_backing)),
    )
}
pub fn require_backed(e: &Env) {
    if accounted(e) < st::get_i128(e, PoolKey::SumLimits) {
        panic_with_error!(e, PoolError::YieldUnderfunded);
    }
}

/// USDC already in Kovan -> vault shares in Kovan. An exact nested transfer auth, never approve().
pub fn invest(e: &Env, amount: i128, min_shares: i128, valid_until: u32) {
    positive(e, amount);
    positive(e, min_shares);
    deadline(e, valid_until);
    let c = checked(e);
    let me = e.current_contract_address();
    let before_cash = cash(e).balance(&me);
    if amount > before_cash {
        panic_with_error!(e, PoolError::YieldLiquidity);
    }
    let shares = token::TokenClient::new(e, &c.vault);
    let before_shares = shares.balance(&me);
    e.authorize_as_current_contract(vec![
        e,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: st::get_address(e, PoolKey::Usdc),
                fn_name: symbol_short!("transfer"),
                args: (me.clone(), c.vault.clone(), amount).into_val(e),
            },
            sub_invocations: Vec::new(e),
        }),
    ]);
    VaultClient::new(e, &c.vault).deposit(&vec![e, amount], &vec![e, amount], &me, &true);
    let minted = math(e, shares.balance(&me).checked_sub(before_shares));
    if minted < min_shares || before_cash - cash(e).balance(&me) != amount {
        panic_with_error!(e, PoolError::YieldSlippage);
    }
    require_backed(e);
    YieldMovement {
        vault: c.vault,
        action: symbol_short!("invest"),
        shares: minted,
        assets: amount,
    }
    .publish(e);
}

/// Existing transferable position -> custody in Kovan, underlying stays in the external vault.
pub fn lock(e: &Env, shares: i128, min_assets: i128, valid_until: u32) {
    positive(e, shares);
    positive(e, min_assets);
    deadline(e, valid_until);
    let c = checked(e);
    let me = e.current_contract_address();
    let t = token::TokenClient::new(e, &c.vault);
    let before = t.balance(&me);
    t.transfer(&st::get_address(e, PoolKey::Owner), &me, &shares);
    let value = quote(e, &c, shares);
    if t.balance(&me) - before != shares || value < min_assets {
        panic_with_error!(e, PoolError::YieldSlippage);
    }
    YieldMovement {
        vault: c.vault,
        action: symbol_short!("lock"),
        shares,
        assets: value,
    }
    .publish(e);
}

pub fn redeem(e: &Env, shares: i128, min_assets: i128, valid_until: u32) {
    positive(e, shares);
    positive(e, min_assets);
    deadline(e, valid_until);
    redeem_inner(e, &checked(e), shares, min_assets);
    require_backed(e);
}
fn redeem_inner(e: &Env, c: &YieldConfig, shares: i128, min_assets: i128) {
    let me = e.current_contract_address();
    let t = token::TokenClient::new(e, &c.vault);
    let before_shares = t.balance(&me);
    let before_cash = cash(e).balance(&me);
    if shares > before_shares {
        panic_with_error!(e, PoolError::YieldLiquidity);
    }
    VaultClient::new(e, &c.vault).withdraw(&shares, &vec![e, min_assets], &me);
    let received = math(e, cash(e).balance(&me).checked_sub(before_cash));
    if before_shares - t.balance(&me) != shares || received < min_assets {
        panic_with_error!(e, PoolError::YieldSlippage);
    }
    YieldMovement {
        vault: c.vault.clone(),
        action: symbol_short!("redeem"),
        shares,
        assets: received,
    }
    .publish(e);
}

/// Called only inside an authorized draw. One bounded redemption; failure rolls everything back.
pub fn ensure_cash(e: &Env, amount: i128) {
    let available = cash(e).balance(&e.current_contract_address());
    if available >= amount {
        return;
    }
    let c = checked(e);
    let shares = token::TokenClient::new(e, &c.vault).balance(&e.current_contract_address());
    let assets = quote(e, &c, shares);
    let shortfall = amount - available;
    if assets < shortfall || assets <= 0 {
        panic_with_error!(e, PoolError::YieldLiquidity);
    }
    // ceil(shortfall * shares / assets). Actual min-out and post-solvency are checked too.
    let numerator = math(e, shortfall.checked_mul(shares));
    let needed = math(
        e,
        (numerator / assets).checked_add(if numerator % assets == 0 { 0 } else { 1 }),
    );
    redeem_inner(e, &c, needed, shortfall);
}

/// Recovery never depends on NAV or redemption liquidity, and tolerates a changed vault hash.
/// No commitments may remain. Returning shares preserves their external yield position.
pub fn release(e: &Env, shares: i128) {
    positive(e, shares);
    if st::get_i128(e, PoolKey::OpenAgents) != 0
        || st::get_i128(e, PoolKey::SumLimits) != 0
        || st::get_i128(e, PoolKey::Outstanding) != 0
    {
        panic_with_error!(e, PoolError::PoolNotEmpty);
    }
    let c = required(e);
    token::TokenClient::new(e, &c.vault).transfer(
        &e.current_contract_address(),
        &st::get_address(e, PoolKey::Owner),
        &shares,
    );
    YieldMovement {
        vault: c.vault,
        action: symbol_short!("release"),
        shares,
        assets: 0,
    }
    .publish(e);
}
pub fn release_all(e: &Env) {
    if let Some(c) = config(e) {
        let shares = token::TokenClient::new(e, &c.vault).balance(&e.current_contract_address());
        if shares > 0 {
            release(e, shares);
        }
    }
}
