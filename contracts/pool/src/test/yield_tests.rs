//! ABI-shaped test double, not a deployed yield provider. Faults deliberately model
//! liquidity loss, changed NAV and dishonest transfer/return behavior.
use super::*;
use crate::yield_source::AssetStrategySet;
use soroban_sdk::{contract, contractimpl, contracttype, Executable, Symbol, Val};

#[contracttype]
#[derive(Clone)]
enum Key {
    Asset,
    Balance(Address),
    Rate,
    Illiquid,
    QuoteFails,
    BadDeposit,
    BadWithdraw,
}
#[contract]
struct MockVault;
#[contractimpl]
impl MockVault {
    pub fn __constructor(e: Env, asset: Address) {
        e.storage().instance().set(&Key::Asset, &asset);
        e.storage().instance().set(&Key::Rate, &10_000i128);
    }
    pub fn get_assets(e: Env) -> Vec<AssetStrategySet> {
        vec![
            &e,
            AssetStrategySet {
                address: e.storage().instance().get(&Key::Asset).unwrap(),
                strategies: Vec::new(&e),
            },
        ]
    }
    pub fn decimals(_e: Env) -> u32 {
        7
    }
    pub fn balance(e: Env, id: Address) -> i128 {
        e.storage().instance().get(&Key::Balance(id)).unwrap_or(0)
    }
    pub fn transfer(e: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0 && Self::balance(e.clone(), from.clone()) >= amount);
        change(&e, &from, -amount);
        change(&e, &to, amount);
    }
    pub fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Vec<i128> {
        assert!(!flag(&e, Key::QuoteFails));
        vec![&e, vault_shares * rate(&e) / 10_000]
    }
    pub fn deposit(
        e: Env,
        amounts_desired: Vec<i128>,
        amounts_min: Vec<i128>,
        from: Address,
        invest: bool,
    ) -> Val {
        from.require_auth();
        assert!(invest && amounts_desired == amounts_min && amounts_desired.len() == 1);
        let amount = amounts_desired.get_unchecked(0);
        token::TokenClient::new(&e, &asset(&e)).transfer(
            &from,
            &e.current_contract_address(),
            &amount,
        );
        let shares = if flag(&e, Key::BadDeposit) {
            0
        } else {
            amount * 10_000 / rate(&e)
        };
        change(&e, &from, shares);
        (amounts_desired, shares, Val::VOID).into_val(&e)
    }
    pub fn withdraw(
        e: Env,
        withdraw_shares: i128,
        min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128> {
        from.require_auth();
        assert!(!flag(&e, Key::Illiquid));
        assert!(withdraw_shares > 0 && Self::balance(e.clone(), from.clone()) >= withdraw_shares);
        let amount = withdraw_shares * rate(&e) / 10_000;
        assert!(amount >= min_amounts_out.get_unchecked(0));
        change(&e, &from, -withdraw_shares);
        if !flag(&e, Key::BadWithdraw) {
            token::TokenClient::new(&e, &asset(&e)).transfer(
                &e.current_contract_address(),
                &from,
                &amount,
            );
        }
        vec![&e, amount]
    }
    // Test-only fault controls, never part of production bytecode.
    pub fn fault(e: Env, name: Symbol, value: bool) {
        let k = if name == Symbol::new(&e, "illiquid") {
            Key::Illiquid
        } else if name == Symbol::new(&e, "quote") {
            Key::QuoteFails
        } else if name == Symbol::new(&e, "deposit") {
            Key::BadDeposit
        } else {
            Key::BadWithdraw
        };
        e.storage().instance().set(&k, &value);
    }
    pub fn set_rate(e: Env, value: i128) {
        e.storage().instance().set(&Key::Rate, &value);
    }
    pub fn mint(e: Env, to: Address, shares: i128) {
        change(&e, &to, shares);
    }
}
fn asset(e: &Env) -> Address {
    e.storage().instance().get(&Key::Asset).unwrap()
}
fn rate(e: &Env) -> i128 {
    e.storage().instance().get(&Key::Rate).unwrap()
}
fn flag(e: &Env, k: Key) -> bool {
    e.storage().instance().get(&k).unwrap_or(false)
}
fn change(e: &Env, id: &Address, amount: i128) {
    let b = MockVault::balance(e.clone(), id.clone());
    e.storage()
        .instance()
        .set(&Key::Balance(id.clone()), &(b + amount));
}
fn hash(vault: &Address) -> BytesN<32> {
    match vault.executable().unwrap() {
        Executable::Wasm(h) => h,
        _ => panic!("expected wasm"),
    }
}
fn setup_yield() -> (Fx, Address) {
    let fx = setup();
    let v = fx.e.register(MockVault, (fx.usdc.clone(),));
    fx.pool.configure_yield(&v, &hash(&v));
    (fx, v)
}
fn invested() -> (Fx, Address, Address) {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    fx.pool.invest(&LOCK, &LOCK, &1000);
    let a = fx
        .pool
        .create_agent(&BytesN::random(&fx.e), &LIMIT, &covenant(&fx));
    (fx, v, a)
}
fn fault(fx: &Fx, v: &Address, name: &str) {
    MockVaultClient::new(&fx.e, v).fault(&Symbol::new(&fx.e, name), &true);
}
fn error(n: u32) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(n)
}

#[test]
fn cash_only_still_default() {
    let fx = setup();
    assert_eq!(fx.pool.get_pool().accounting_version, 3);
    assert!(fx.pool.get_yield().vault.is_none());
    assert_eq!(fx.pool.try_invest(&1, &1, &100), Err(Ok(error(19))));
}
#[test]
fn configure_checks_owner_and_cannot_replace_vault() {
    let (fx, v) = setup_yield();
    assert_eq!(
        fx.pool.try_configure_yield(&v, &hash(&v)),
        Err(Ok(error(20)))
    );
    fx.e.mock_auths(&[]);
    assert!(fx.pool.try_configure_yield(&v, &hash(&v)).is_err());
}
#[test]
fn configure_rejects_other_asset_or_code() {
    let fx = setup();
    let v = fx.e.register(MockVault, (Address::generate(&fx.e),));
    assert_eq!(
        fx.pool.try_configure_yield(&v, &hash(&v)),
        Err(Ok(error(21)))
    );
    assert_eq!(
        fx.pool.try_configure_yield(&v, &BytesN::random(&fx.e)),
        Err(Ok(error(22)))
    );
}
#[test]
fn existing_cash_budgets_cannot_be_silently_opted_in() {
    let fx = setup();
    funded_agent(&fx);
    let v = fx.e.register(MockVault, (fx.usdc.clone(),));
    assert_eq!(
        fx.pool.try_configure_yield(&v, &hash(&v)),
        Err(Ok(error(18)))
    );
}
#[test]
fn invest_uses_exact_nested_auth_and_accounts_once() {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr,
            fn_name: "invest",
            args: (LOCK, LOCK, 1000u32).into_val(&fx.e),
            sub_invokes: &[],
        },
    }]);
    fx.pool.invest(&LOCK, &LOCK, &1000);
    let auths = fx.e.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, fx.owner);
    assert!(auths[0].1.sub_invocations.is_empty()); // no owner-side vault/USDC authorization
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
    assert_eq!(bal(&fx, &v), LOCK);
    assert_eq!(fx.pool.get_yield().shares, LOCK);
    assert_eq!(fx.pool.get_yield().estimated_assets, LOCK);
    assert_eq!(fx.pool.get_pool().locked, LOCK * 9 / 10);
}
#[test]
fn lock_existing_position_moves_shares_not_underlying() {
    let (fx, v) = setup_yield();
    let vault = MockVaultClient::new(&fx.e, &v);
    vault.mint(&fx.owner, &LOCK);
    token::StellarAssetClient::new(&fx.e, &fx.usdc).mint(&v, &LOCK);
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr,
            fn_name: "lock_shares",
            args: (LOCK, LOCK, 1000u32).into_val(&fx.e),
            sub_invokes: &[MockAuthInvoke {
                contract: &v,
                fn_name: "transfer",
                args: (fx.owner.clone(), fx.pool_addr.clone(), LOCK).into_val(&fx.e),
                sub_invokes: &[],
            }],
        },
    }]);
    fx.pool.lock_shares(&LOCK, &LOCK, &1000);
    assert_eq!(fx.e.auths()[0].1.sub_invocations.len(), 1);
    assert_eq!(vault.balance(&fx.owner), 0);
    assert_eq!(bal(&fx, &v), LOCK);
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
    assert_eq!(fx.pool.get_pool().locked, LOCK * 9 / 10);
    // The same wallet no longer has these shares to lock in another pool.
    assert!(fx.pool.try_lock_shares(&1, &1, &1000).is_err());
}
#[test]
fn draw_redeems_just_the_missing_cash_and_preserves_accounting() {
    let (fx, v, a) = invested();
    fx.pool.draw(&a, &LIMIT);
    assert_eq!(bal(&fx, &a), LIMIT);
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
    assert_eq!(
        MockVaultClient::new(&fx.e, &v).balance(&fx.pool_addr),
        LOCK - LIMIT
    );
    assert_eq!(fx.pool.get_pool().outstanding, LIMIT);
    assert_eq!(fx.pool.get_pool().locked, (LOCK - LIMIT) * 9 / 10 + LIMIT);
}
#[test]
fn cash_buffer_is_used_before_redeeming() {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    fx.pool.invest(&(LOCK - LIMIT), &(LOCK - LIMIT), &1000);
    let a = fx
        .pool
        .create_agent(&BytesN::random(&fx.e), &LIMIT, &covenant(&fx));
    fault(&fx, &v, "illiquid");
    fx.pool.draw(&a, &LIMIT);
    assert_eq!(fx.pool.get_yield().shares, LOCK - LIMIT);
}
#[test]
fn illiquidity_and_dishonest_withdrawals_roll_back_draw_entirely() {
    for name in ["illiquid", "withdraw"] {
        let (fx, v, a) = invested();
        fault(&fx, &v, name);
        assert!(fx.pool.try_draw(&a, &LIMIT).is_err());
        assert_eq!(fx.pool.get_agent(&a).drawn, 0);
        assert_eq!(fx.pool.get_pool().outstanding, 0);
        assert_eq!(fx.pool.get_yield().shares, LOCK);
        assert_eq!(bal(&fx, &a), 0);
    }
}
#[test]
fn losses_freeze_draws_even_if_some_cash_remains() {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    fx.pool.invest(&(LOCK - LIMIT), &(LOCK - LIMIT), &1000);
    let a = fx
        .pool
        .create_agent(&BytesN::random(&fx.e), &40_000_000, &covenant(&fx));
    MockVaultClient::new(&fx.e, &v).set_rate(&5_000);
    assert_eq!(fx.pool.try_draw(&a, &1), Err(Ok(error(26))));
    assert!(fx.pool.try_withdraw(&1).is_err());
    assert_eq!(fx.pool.get_agent(&a).drawn, 0);
    fx.pool.revoke(&a, &fx.owner);
    fx.pool.close(&a, &fx.owner);
    fx.pool.close_pool();
    assert_eq!(
        MockVaultClient::new(&fx.e, &v).balance(&fx.owner),
        LOCK - LIMIT
    );
}
#[test]
fn yield_gains_increase_backing_without_changing_limits() {
    let (fx, v, a) = invested();
    MockVaultClient::new(&fx.e, &v).set_rate(&12_000);
    assert_eq!(fx.pool.get_yield().estimated_assets, LOCK * 12 / 10);
    assert_eq!(fx.pool.get_pool().sum_limits, LIMIT);
    assert_eq!(fx.pool.get_agent(&a).draw_limit, LIMIT);
}
#[test]
fn cannot_allocate_the_full_undiscounted_nav() {
    let (fx, _, _) = invested();
    assert!(fx
        .pool
        .try_create_agent(&BytesN::random(&fx.e), &(LOCK - LIMIT), &covenant(&fx))
        .is_err());
}
#[test]
fn slippage_and_expired_quotes_roll_back() {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    assert_eq!(
        fx.pool.try_invest(&LOCK, &(LOCK + 1), &1000),
        Err(Ok(error(24)))
    );
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK);
    assert_eq!(fx.pool.get_yield().shares, 0);
    fx.pool.invest(&LOCK, &LOCK, &1000);
    assert!(fx
        .pool
        .try_redeem_shares(&LIMIT, &(LIMIT + 1), &1000)
        .is_err());
    assert_eq!(fx.pool.get_yield().shares, LOCK);
    fx.e.ledger().set_sequence_number(1001);
    assert_eq!(fx.pool.try_invest(&1, &1, &1000), Err(Ok(error(23))));
    assert_eq!(fx.pool.try_lock_shares(&1, &1, &1000), Err(Ok(error(23))));
    assert_eq!(fx.pool.try_redeem_shares(&1, &1, &1000), Err(Ok(error(23))));
    assert_eq!(MockVaultClient::new(&fx.e, &v).balance(&fx.pool_addr), LOCK);
}
#[test]
fn invalid_amounts_and_no_owner_signature_are_rejected() {
    let (fx, _) = setup_yield();
    for n in [0, -1] {
        assert_eq!(fx.pool.try_invest(&n, &1, &1000), Err(Ok(error(13))));
        assert_eq!(fx.pool.try_lock_shares(&n, &1, &1000), Err(Ok(error(13))));
        assert_eq!(fx.pool.try_redeem_shares(&n, &1, &1000), Err(Ok(error(13))));
        assert_eq!(fx.pool.try_release_shares(&n), Err(Ok(error(13))));
    }
    fx.e.mock_auths(&[]);
    assert!(fx.pool.try_invest(&1, &1, &1000).is_err());
    assert!(fx.pool.try_lock_shares(&1, &1, &1000).is_err());
    assert!(fx.pool.try_redeem_shares(&1, &1, &1000).is_err());
    assert!(fx.pool.try_release_shares(&1).is_err());
}
#[test]
fn invest_cannot_remove_backing_buffer_from_existing_commitments() {
    let (fx, _) = setup_yield();
    fx.pool.fund(&LOCK);
    fx.pool
        .create_agent(&BytesN::random(&fx.e), &LOCK, &covenant(&fx));
    assert_eq!(fx.pool.try_invest(&LOCK, &LOCK, &1000), Err(Ok(error(26))));
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK);
}
#[test]
fn bad_mint_is_not_accepted() {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    fault(&fx, &v, "deposit");
    assert_eq!(fx.pool.try_invest(&LOCK, &1, &1000), Err(Ok(error(24))));
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK);
}
#[test]
fn manual_redemption_returns_cash_to_pool_not_owner() {
    let (fx, _, _) = invested();
    let owner_cash = bal(&fx, &fx.owner);
    fx.pool.redeem_shares(&LIMIT, &LIMIT, &1000);
    assert_eq!(bal(&fx, &fx.pool_addr), LIMIT);
    assert_eq!(bal(&fx, &fx.owner), owner_cash);
}
#[test]
fn locked_backing_cannot_be_released_until_agents_close() {
    let (fx, _, a) = invested();
    assert_eq!(fx.pool.try_release_shares(&1), Err(Ok(error(18))));
    fx.pool.close(&a, &fx.owner);
    fx.pool.release_shares(&LOCK);
    assert_eq!(fx.pool.get_yield().shares, 0);
}
#[test]
fn quote_failure_does_not_hide_pool_or_prevent_recovery() {
    let (fx, v, a) = invested();
    fault(&fx, &v, "quote");
    assert!(!fx.pool.get_yield().valuation_ok);
    assert_eq!(fx.pool.get_pool().locked, 0);
    assert!(fx.pool.try_draw(&a, &1).is_err());
    fx.pool.fund(&LIMIT); // cash top-up works even while the provider cannot quote
    fx.pool.draw(&a, &LIMIT); // fully cash-backed commitments still work
    fx.pool.close(&a, &fx.owner);
    fx.pool.close_pool();
    assert!(fx.pool.get_pool().closed);
    assert_eq!(MockVaultClient::new(&fx.e, &v).balance(&fx.owner), LOCK);
}
#[test]
fn closure_returns_shares_in_kind_even_when_redemption_is_paused() {
    let (fx, v, a) = invested();
    fault(&fx, &v, "illiquid");
    fx.pool.close(&a, &fx.owner);
    fx.pool.close_pool();
    assert_eq!(MockVaultClient::new(&fx.e, &v).balance(&fx.owner), LOCK);
    assert_eq!(bal(&fx, &v), LOCK); // underlying never redeemed
    assert!(fx.pool.get_pool().closed);
    assert_eq!(fx.pool.try_invest(&1, &1, &1000), Err(Ok(error(17))));
    assert_eq!(fx.pool.try_lock_shares(&1, &1, &1000), Err(Ok(error(17))));
    MockVaultClient::new(&fx.e, &v).transfer(&fx.owner, &fx.pool_addr, &LIMIT);
    fx.pool.release_shares(&LIMIT); // late share refunds remain recoverable
}

#[test]
fn code_pin_failure_blocks_investment_but_not_in_kind_exit() {
    let (fx, v, a) = invested();
    fx.e.as_contract(&fx.pool_addr, || {
        fx.e.storage().instance().set(
            &crate::storage::PoolKey::YieldConfig,
            &crate::yield_source::YieldConfig {
                vault: v.clone(),
                wasm_hash: BytesN::random(&fx.e),
            },
        );
    });
    assert!(!fx.pool.get_yield().valuation_ok);
    assert!(!fx.pool.get_yield().share_balance_ok);
    assert_eq!(fx.pool.get_pool().locked, 0);
    assert_eq!(fx.pool.try_invest(&1, &1, &1000), Err(Ok(error(22))));
    assert_eq!(fx.pool.try_lock_shares(&1, &1, &1000), Err(Ok(error(22))));
    assert_eq!(fx.pool.try_redeem_shares(&1, &1, &1000), Err(Ok(error(22))));
    fx.pool.close(&a, &fx.owner);
    fx.pool.close_pool();
    assert_eq!(MockVaultClient::new(&fx.e, &v).balance(&fx.owner), LOCK);
}
#[test]
fn partial_cash_shortfall_rounds_shares_up_not_down() {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    fx.pool.invest(&(LOCK - 1), &(LOCK - 1), &1000);
    MockVaultClient::new(&fx.e, &v).set_rate(&12_345);
    let a = fx
        .pool
        .create_agent(&BytesN::random(&fx.e), &LIMIT, &covenant(&fx));
    fx.pool.draw(&a, &LIMIT);
    assert_eq!(bal(&fx, &a), LIMIT);
    assert!(bal(&fx, &fx.pool_addr) <= 1);
    assert_eq!(fx.pool.get_pool().outstanding, LIMIT);
}
#[test]
fn budgets_can_be_reduced_while_insolvent_and_topups_restore_draws() {
    let (fx, v) = setup_yield();
    fx.pool.fund(&LOCK);
    fx.pool.invest(&LOCK, &LOCK, &1000);
    let a = fx
        .pool
        .create_agent(&BytesN::random(&fx.e), &40_000_000, &covenant(&fx));
    MockVaultClient::new(&fx.e, &v).set_rate(&5_000);
    let amendment = kovan_covenant_types::Amendment {
        provider_per_transfer_cap: 2_000_000,
        provider_total_cap: 5_000_000,
        recipient_per_transfer_cap: 0,
        recipient_total_cap: 0,
        expiry: 10_000,
    };
    fx.pool.amend(&a, &30_000_000, &amendment);
    assert_eq!(fx.pool.try_draw(&a, &1), Err(Ok(error(26))));
    fx.pool.fund(&10_000_000);
    fx.pool.draw(&a, &LIMIT);
}
#[test]
fn direct_share_deposits_are_counted_and_recoverable() {
    let (fx, v) = setup_yield();
    let vault = MockVaultClient::new(&fx.e, &v);
    vault.mint(&fx.owner, &LOCK);
    vault.transfer(&fx.owner, &fx.pool_addr, &LOCK);
    assert_eq!(fx.pool.get_pool().locked, LOCK * 9 / 10);
    fx.pool.close_pool();
    assert_eq!(vault.balance(&fx.owner), LOCK);
}
#[test]
fn minimum_output_cannot_be_zero_or_negative() {
    let (fx, _) = setup_yield();
    for n in [0, -1] {
        assert_eq!(fx.pool.try_invest(&1, &n, &1000), Err(Ok(error(13))));
        assert_eq!(fx.pool.try_lock_shares(&1, &n, &1000), Err(Ok(error(13))));
        assert_eq!(fx.pool.try_redeem_shares(&1, &n, &1000), Err(Ok(error(13))));
    }
}
