#![cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractimpl, testutils::Address as _, vec, Address, Env, Symbol, Vec};

use crate::covenant::{self, CovenantError, CovenantParams, CovenantState};

/// Bare contract so storage calls run inside a contract context.
#[contract]
struct Host;
#[contractimpl]
impl Host {}

fn params(e: &Env) -> CovenantParams {
    CovenantParams {
        pool: Address::generate(e),
        usdc: Address::generate(e),
        providers: vec![e, Address::generate(e)],
        provider_per_transfer_cap: 2_000_000,
        provider_total_cap: 5_000_000,
        recipients: Vec::new(e),
        recipient_per_transfer_cap: 0,
        recipient_total_cap: 0,
        calls: Vec::new(e),
        expiry: 1_000,
    }
}

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
    let e = Env::default();
    let host = e.register(Host, ());
    let account = Address::generate(&e);
    let state = CovenantState {
        params: params(&e),
        rule_id: 0,
        provider_spent: 7,
        recipient_spent: 0,
        revoked: false,
    };
    let got = e.as_contract(&host, || {
        covenant::set_state(&e, &account, &state);
        covenant::get_state(&e, &account)
    });
    assert_eq!(got, state);
    let _ = CovenantError::NotInstalled;
    let _: Symbol = Symbol::new(&e, "transfer");
}
