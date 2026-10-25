#![cfg(test)]
extern crate std;

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke, MuxedAddress as _},
    vec, Address, Env, IntoVal, String, Symbol, Val, Vec,
};
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

use crate::covenant::{self, Amendment, CallRule, CovenantError, CovenantParams, CovenantState};

/// Bare contract so storage calls run inside a contract context.
#[contract]
struct Host;
#[contractimpl]
impl Host {}

struct Fx {
    e: Env,
    host: Address,
    account: Address,
    pool: Address,
    usdc: Address,
    prov: Address,
    rec: Address,
    other: Address,
    rule: ContextRule,
    expiry: u32,
}

const PROV_PER: i128 = 2_000_000;
const PROV_TOTAL: i128 = 5_000_000;
const REC_PER: i128 = 1_000_000;
const REC_TOTAL: i128 = 1_000_000;

fn params(e: &Env, pool: &Address, usdc: &Address, prov: &Address, rec: &Address, other: &Address, expiry: u32) -> CovenantParams {
    CovenantParams {
        pool: pool.clone(),
        usdc: usdc.clone(),
        providers: vec![e, prov.clone()],
        provider_per_transfer_cap: PROV_PER,
        provider_total_cap: PROV_TOTAL,
        recipients: vec![e, rec.clone()],
        recipient_per_transfer_cap: REC_PER,
        recipient_total_cap: REC_TOTAL,
        calls: vec![
            e,
            CallRule { contract: other.clone(), fn_name: symbol_short!("ping"), amount_arg: Some(0), amount_cap: 10 },
        ],
        expiry,
    }
}

fn rule(e: &Env, account: &Address) -> ContextRule {
    ContextRule {
        id: 0,
        context_type: ContextRuleType::Default,
        name: String::from_str(e, "covenant"),
        signers: vec![e, Signer::Delegated(account.clone())],
        signer_ids: vec![e, 0],
        policies: Vec::new(e),
        policy_ids: Vec::new(e),
        valid_until: None,
    }
}

fn install_default() -> Fx {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_sequence_number(100);
    let host = e.register(Host, ());
    let account = Address::generate(&e);
    let pool = Address::generate(&e);
    let usdc = Address::generate(&e);
    let prov = Address::generate(&e);
    let rec = Address::generate(&e);
    let other = Address::generate(&e);
    let expiry = 200;
    let rule = rule(&e, &account);
    let p = params(&e, &pool, &usdc, &prov, &rec, &other, expiry);
    e.as_contract(&host, || covenant::install(&e, &p, &rule, &account));
    Fx { e, host, account, pool, usdc, prov, rec, other, rule, expiry }
}

fn ctx(_e: &Env, contract: &Address, fn_name: Symbol, args: Vec<Val>) -> Context {
    Context::Contract(ContractContext { contract: contract.clone(), fn_name, args })
}

fn transfer_ctx(fx: &Fx, to: Val, amount: Val) -> Context {
    let e = &fx.e;
    ctx(e, &fx.usdc, symbol_short!("transfer"), vec![e, fx.account.clone().into_val(e), to, amount])
}

fn signers(fx: &Fx) -> Vec<Signer> {
    vec![&fx.e, Signer::Delegated(fx.account.clone())]
}

fn enforce(fx: &Fx, c: Context) {
    let s = signers(fx);
    fx.e.as_contract(&fx.host, || covenant::enforce(&fx.e, &c, &s, &fx.rule, &fx.account));
}

fn state(fx: &Fx) -> CovenantState {
    fx.e.as_contract(&fx.host, || covenant::get_state(&fx.e, &fx.account))
}

// ---------------------------------------------------------------- storage

#[test]
#[should_panic(expected = "Error(Contract, #3900)")]
fn get_state_panics_when_not_installed() {
    let e = Env::default();
    let host = e.register(Host, ());
    let account = Address::generate(&e);
    e.as_contract(&host, || covenant::get_state(&e, &account));
}

#[test]
fn set_then_get_roundtrips() {
    let fx = install_default();
    let mut s = state(&fx);
    s.provider_spent = 7;
    fx.e.as_contract(&fx.host, || covenant::set_state(&fx.e, &fx.account, &s));
    assert_eq!(state(&fx), s);
}

// ---------------------------------------------------------------- spend

#[test]
fn enforce_allows_provider_transfer_within_caps() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), PROV_PER.into_val(e)));
    assert_eq!(state(&fx).provider_spent, PROV_PER);
}

#[test]
fn enforce_allows_recipient_transfer_and_tracks_separately() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, fx.rec.clone().into_val(e), REC_PER.into_val(e)));
    let s = state(&fx);
    assert_eq!(s.recipient_spent, REC_PER);
    assert_eq!(s.provider_spent, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3910)")]
fn enforce_rejects_wrong_asset() {
    let fx = install_default();
    let e = &fx.e;
    let token = Address::generate(e);
    let c = ctx(e, &token, symbol_short!("transfer"), vec![e, fx.account.clone().into_val(e), fx.prov.clone().into_val(e), 1i128.into_val(e)]);
    enforce(&fx, c);
}

#[test]
#[should_panic(expected = "Error(Contract, #3904)")]
fn enforce_rejects_payee_not_listed() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, Address::generate(e).into_val(e), 1i128.into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3905)")]
fn enforce_rejects_zero_amount() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), 0i128.into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3905)")]
fn enforce_rejects_negative_amount() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), (-1i128).into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3906)")]
fn enforce_rejects_over_per_transfer_cap() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), (PROV_PER + 1).into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3907)")]
fn enforce_rejects_over_total_cap() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), PROV_PER.into_val(e)));
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), PROV_PER.into_val(e)));
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), PROV_PER.into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3908)")]
fn enforce_rejects_at_expiry_ledger() {
    let fx = install_default();
    let e = &fx.e;
    e.ledger().set_sequence_number(fx.expiry);
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), 1i128.into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3904)")]
fn enforce_rejects_muxed_payee() {
    let fx = install_default();
    let e = &fx.e;
    let muxed = soroban_sdk::MuxedAddress::generate(e);
    enforce(&fx, transfer_ctx(&fx, muxed.into_val(e), 1i128.into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3902)")]
fn enforce_rejects_non_i128_amount() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), symbol_short!("lots").into_val(e)));
}

#[test]
fn enforce_allows_return_to_pool_after_expiry() {
    let fx = install_default();
    let e = &fx.e;
    e.ledger().set_sequence_number(fx.expiry + 1);
    enforce(&fx, transfer_ctx(&fx, fx.pool.clone().into_val(e), 999_000_000i128.into_val(e)));
    assert_eq!(state(&fx).provider_spent, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #3902)")]
fn enforce_rejects_approve_on_usdc() {
    let fx = install_default();
    let e = &fx.e;
    let c = ctx(e, &fx.usdc, symbol_short!("approve"), vec![e, fx.account.clone().into_val(e), fx.prov.clone().into_val(e), 1i128.into_val(e), 1000u32.into_val(e)]);
    enforce(&fx, c);
}

// ---------------------------------------------------------------- routing

#[test]
#[should_panic(expected = "Error(Contract, #3912)")]
fn enforce_rejects_self_call() {
    let fx = install_default();
    let e = &fx.e;
    let c = ctx(e, &fx.account, Symbol::new(e, "add_context_rule"), Vec::new(e));
    enforce(&fx, c);
}

#[test]
fn enforce_allows_pool_draw() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, ctx(e, &fx.pool, symbol_short!("draw"), vec![e, fx.account.clone().into_val(e), 1i128.into_val(e)]));
}

#[test]
fn enforce_allows_pool_lifecycle_after_expiry() {
    let fx = install_default();
    let e = &fx.e;
    e.ledger().set_sequence_number(fx.expiry + 1);
    enforce(&fx, ctx(e, &fx.pool, Symbol::new(e, "return_funds"), Vec::new(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3910)")]
fn enforce_rejects_pool_unknown_fn() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, ctx(e, &fx.pool, symbol_short!("fund"), vec![e, 1i128.into_val(e)]));
}

#[test]
fn enforce_allows_listed_call_within_cap() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, ctx(e, &fx.other, symbol_short!("ping"), vec![e, 5i128.into_val(e)]));
}

#[test]
#[should_panic(expected = "Error(Contract, #3911)")]
fn enforce_rejects_listed_call_over_cap() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, ctx(e, &fx.other, symbol_short!("ping"), vec![e, 11i128.into_val(e)]));
}

#[test]
#[should_panic(expected = "Error(Contract, #3910)")]
fn enforce_rejects_unlisted_call() {
    let fx = install_default();
    let e = &fx.e;
    enforce(&fx, ctx(e, &fx.other, symbol_short!("pong"), vec![e, 1i128.into_val(e)]));
}

#[test]
#[should_panic(expected = "Error(Contract, #3908)")]
fn enforce_rejects_listed_call_after_expiry() {
    let fx = install_default();
    let e = &fx.e;
    e.ledger().set_sequence_number(fx.expiry);
    enforce(&fx, ctx(e, &fx.other, symbol_short!("ping"), vec![e, 1i128.into_val(e)]));
}

// ---------------------------------------------------------------- revoke / signers / admin

#[test]
#[should_panic(expected = "Error(Contract, #3909)")]
fn enforce_rejects_when_revoked() {
    let fx = install_default();
    let e = &fx.e;
    fx.e.as_contract(&fx.host, || covenant::set_revoked(e, &fx.account, true));
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), 1i128.into_val(e)));
}

#[test]
#[should_panic(expected = "Error(Contract, #3913)")]
fn enforce_rejects_without_signers() {
    let fx = install_default();
    let e = &fx.e;
    let c = transfer_ctx(&fx, fx.prov.clone().into_val(e), 1i128.into_val(e));
    let none: Vec<Signer> = Vec::new(e);
    fx.e.as_contract(&fx.host, || covenant::enforce(e, &c, &none, &fx.rule, &fx.account));
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn set_revoked_requires_pool_auth() {
    let fx = install_default();
    let e = &fx.e;
    let stranger = Address::generate(e);
    e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke { contract: &fx.host, fn_name: "x", args: Vec::new(e), sub_invokes: &[] },
    }]);
    e.as_contract(&fx.host, || covenant::set_revoked(e, &fx.account, true));
}

#[test]
fn amend_updates_caps_and_expiry() {
    let fx = install_default();
    let e = &fx.e;
    let a = Amendment {
        provider_per_transfer_cap: PROV_PER * 2,
        provider_total_cap: PROV_TOTAL * 2,
        recipient_per_transfer_cap: REC_PER,
        recipient_total_cap: REC_TOTAL,
        expiry: fx.expiry + 100,
    };
    e.as_contract(&fx.host, || covenant::amend(e, &fx.account, &a));
    e.ledger().set_sequence_number(fx.expiry + 50);
    enforce(&fx, transfer_ctx(&fx, fx.prov.clone().into_val(e), (PROV_PER * 2).into_val(e)));
    assert_eq!(state(&fx).params.expiry, fx.expiry + 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #3901)")]
fn install_twice_panics() {
    let fx = install_default();
    let p = state(&fx).params;
    fx.e.as_contract(&fx.host, || covenant::install(&fx.e, &p, &fx.rule, &fx.account));
}

#[test]
#[should_panic(expected = "Error(Contract, #3902)")]
fn uninstall_panics() {
    let fx = install_default();
    fx.e.as_contract(&fx.host, || covenant::uninstall(&fx.e, &fx.rule, &fx.account));
}

#[test]
fn error_enum_is_exhaustively_numbered() {
    assert_eq!(CovenantError::NotPool as u32, 3914);
}
