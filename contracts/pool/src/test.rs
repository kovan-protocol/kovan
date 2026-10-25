#![cfg(test)]
extern crate std;

use kovan_covenant_policy::{CovenantParams, CovenantPolicyContract, CovenantPolicyContractClient};
use kovan_ed25519_verifier::Ed25519VerifierContract;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, MockAuth, MockAuthInvoke},
    token, vec, Address, BytesN, Env, IntoVal, Vec,
};

use crate::contract::{KovanPool, KovanPoolClient};
use crate::storage::Status;

mod account_wasm {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/kovan_agent_account.wasm");
}

pub struct Fx {
    pub e: Env,
    pub pool: KovanPoolClient<'static>,
    pub pool_addr: Address,
    pub usdc: Address,
    pub owner: Address,
    pub policy: Address,
    pub prov: Address,
}

pub const LOCK: i128 = 50_000_000;
pub const LIMIT: i128 = 5_000_000;

pub fn covenant(fx: &Fx) -> CovenantParams {
    CovenantParams {
        pool: fx.pool_addr.clone(),
        usdc: fx.usdc.clone(),
        providers: vec![&fx.e, fx.prov.clone()],
        provider_per_transfer_cap: 2_000_000,
        provider_total_cap: 5_000_000,
        recipients: Vec::new(&fx.e),
        recipient_per_transfer_cap: 0,
        recipient_total_cap: 0,
        calls: Vec::new(&fx.e),
        expiry: 10_000,
    }
}

pub fn setup() -> Fx {
    let e = Env::default();
    e.mock_all_auths();
    let owner = Address::generate(&e);
    let admin = Address::generate(&e);
    let usdc_sac = e.register_stellar_asset_contract_v2(admin);
    let usdc = usdc_sac.address();
    token::StellarAssetClient::new(&e, &usdc).mint(&owner, &100_000_000);
    let policy = e.register(CovenantPolicyContract, ());
    let verifier = e.register(Ed25519VerifierContract, ());
    let wasm_hash = e.deployer().upload_contract_wasm(account_wasm::WASM);
    let pool_addr = e.register(KovanPool, (owner.clone(), usdc.clone(), wasm_hash, policy.clone(), verifier));
    let pool = KovanPoolClient::new(&e, &pool_addr);
    // Leak the env so the client can borrow it for 'static in the fixture.
    let pool = unsafe { core::mem::transmute::<KovanPoolClient<'_>, KovanPoolClient<'static>>(pool) };
    let prov = Address::generate(&e);
    Fx { e, pool, pool_addr, usdc, owner, policy, prov }
}

fn bal(fx: &Fx, who: &Address) -> i128 {
    token::TokenClient::new(&fx.e, &fx.usdc).balance(who)
}

fn funded_agent(fx: &Fx) -> Address {
    fx.pool.fund(&LOCK);
    fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &LIMIT, &covenant(fx))
}

#[test]
fn fund_locks_usdc() {
    let fx = setup();
    fx.pool.fund(&LOCK);
    assert_eq!(fx.pool.get_pool().locked, LOCK);
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK);
}

#[test]
fn create_agent_within_locked() {
    let fx = setup();
    let agent = funded_agent(&fx);
    let info = fx.pool.get_pool();
    assert_eq!(info.sum_limits, LIMIT);
    assert_eq!(info.agent_count, 1);
    let rec = fx.pool.get_agent(&agent);
    assert_eq!(rec.status, Status::Active);
    assert_eq!(rec.draw_limit, LIMIT);
    assert_eq!(rec.drawn, 0);
    assert_eq!(fx.pool.list_agents(), vec![&fx.e, agent.clone()]);
    // covenant installed on the policy with pool/usdc pinned by the pool
    let s = CovenantPolicyContractClient::new(&fx.e, &fx.policy).get_covenant(&agent);
    assert_eq!(s.params.pool, fx.pool_addr);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn create_agent_rejects_over_locked() {
    let fx = setup();
    fx.pool.fund(&LOCK);
    fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &(LOCK + 1), &covenant(&fx));
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn create_agent_requires_owner() {
    let fx = setup();
    fx.pool.fund(&LOCK);
    let stranger = Address::generate(&fx.e);
    fx.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke { contract: &fx.pool_addr, fn_name: "create_agent", args: Vec::new(&fx.e), sub_invokes: &[] },
    }]);
    fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &LIMIT, &covenant(&fx));
}

#[test]
fn draw_within_limit_moves_only_bond() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    assert_eq!(bal(&fx, &agent), LIMIT);
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK - LIMIT);
    assert_eq!(fx.pool.get_agent(&agent).drawn, LIMIT);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn draw_rejects_over_limit() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &(LIMIT + 1));
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn draw_requires_agent_auth() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke { contract: &fx.pool_addr, fn_name: "draw", args: Vec::new(&fx.e), sub_invokes: &[] },
    }]);
    fx.pool.draw(&agent, &1);
}

#[test]
fn return_funds_by_agent_decrements_drawn() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    fx.pool.return_funds(&agent, &agent, &2_000_000);
    assert_eq!(fx.pool.get_agent(&agent).drawn, 3_000_000);
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK - 3_000_000);
}

#[test]
fn return_funds_by_owner_without_agent_sig() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    // only the owner signs; the agent account signs nothing
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr,
            fn_name: "return_funds",
            args: (agent.clone(), fx.owner.clone(), 1_000_000i128).into_val(&fx.e),
            sub_invokes: &[],
        },
    }]);
    fx.pool.return_funds(&agent, &fx.owner, &1_000_000);
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK - 4_000_000);
    assert_eq!(fx.pool.get_agent(&agent).drawn, 4_000_000);
}

#[test]
fn return_funds_clamps_drawn_at_zero() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    token::StellarAssetClient::new(&fx.e, &fx.usdc).mint(&agent, &1_000_000); // earnings
    fx.pool.return_funds(&agent, &agent, &6_000_000);
    assert_eq!(fx.pool.get_agent(&agent).drawn, 0);
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK + 1_000_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn withdraw_rejects_below_sum_limits() {
    let fx = setup();
    funded_agent(&fx);
    fx.pool.withdraw(&(LOCK - LIMIT + 1));
}

#[test]
fn withdraw_unlocked_funds() {
    let fx = setup();
    funded_agent(&fx);
    fx.pool.withdraw(&(LOCK - LIMIT));
    assert_eq!(fx.pool.get_pool().locked, LIMIT);
    assert_eq!(bal(&fx, &fx.owner), 100_000_000 - LIMIT);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn sum_limits_le_locked_after_two_agents() {
    let fx = setup();
    fx.pool.fund(&LOCK);
    fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &30_000_000, &covenant(&fx));
    fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &20_000_000, &covenant(&fx));
    assert_eq!(fx.pool.get_pool().sum_limits, LOCK);
    fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &1, &covenant(&fx));
}
