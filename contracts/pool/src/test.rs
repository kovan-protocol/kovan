#![cfg(test)]
extern crate std;

use kovan_covenant_policy::{CovenantParams, CovenantPolicyContract, CovenantPolicyContractClient};
use kovan_ed25519_verifier::Ed25519VerifierContract;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _, Ledger as _, MockAuth, MockAuthInvoke},
    token, vec, Address, BytesN, Env, IntoVal, TryFromVal, Vec,
};

use crate::contract::{KovanPool, KovanPoolClient};
use crate::storage::Status;

mod lifecycle;

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
    pub verifier: Address,
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
    let pool_addr = e.register(KovanPool, (owner.clone(), usdc.clone(), wasm_hash, policy.clone(), verifier.clone()));
    let pool = KovanPoolClient::new(&e, &pool_addr);
    // Leak the env so the client can borrow it for 'static in the fixture.
    let pool = unsafe { core::mem::transmute::<KovanPoolClient<'_>, KovanPoolClient<'static>>(pool) };
    let prov = Address::generate(&e);
    Fx { e, pool, pool_addr, usdc, owner, policy, verifier, prov }
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
    assert_eq!(fx.pool.get_pool().locked, LOCK + 1_000_000);
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

// ---------------------------------------------------------------- lifecycle (Task 6)

use kovan_covenant_policy::Amendment;

fn amendment(expiry: u32) -> Amendment {
    Amendment {
        provider_per_transfer_cap: 4_000_000,
        provider_total_cap: 8_000_000,
        recipient_per_transfer_cap: 0,
        recipient_total_cap: 0,
        expiry,
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn revoke_blocks_draw() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.revoke(&agent, &fx.owner);
    assert_eq!(fx.pool.get_agent(&agent).status, Status::Revoked);
    assert!(CovenantPolicyContractClient::new(&fx.e, &fx.policy).get_covenant(&agent).revoked);
    fx.pool.draw(&agent, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn revoke_requires_owner_or_parent() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.revoke(&agent, &Address::generate(&fx.e));
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn amend_rejects_below_drawn() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    fx.pool.amend(&agent, &(LIMIT - 1), &amendment(10_000));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn amend_rejects_over_locked() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.amend(&agent, &(LOCK + 1), &amendment(10_000));
}

#[test]
fn amend_updates_policy_caps() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.amend(&agent, &(LIMIT * 2), &amendment(20_000));
    let rec = fx.pool.get_agent(&agent);
    assert_eq!(rec.draw_limit, LIMIT * 2);
    assert_eq!(fx.pool.get_pool().sum_limits, LIMIT * 2);
    let s = CovenantPolicyContractClient::new(&fx.e, &fx.policy).get_covenant(&agent);
    assert_eq!(s.params.provider_per_transfer_cap, 4_000_000);
    assert_eq!(s.params.expiry, 20_000);
}

#[test]
fn settle_then_close_recovers_outstanding_balance() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    fx.pool.settle(&agent);
    assert_eq!(fx.pool.get_agent(&agent).status, Status::SettleRequested);
    assert!(CovenantPolicyContractClient::new(&fx.e, &fx.policy).get_covenant(&agent).revoked);
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(fx.pool.get_agent(&agent).status, Status::Closed);
    assert_eq!(fx.pool.get_pool().sum_limits, 0);
    assert_eq!(fx.pool.get_agent(&agent).drawn, 0);
    assert_eq!(fx.pool.get_pool().locked, LOCK);
    assert_eq!(bal(&fx, &agent), 0);
}

/// Available pool funds must be backed by actual tokens, even while agents
/// have outstanding advances. Closed accounts no longer reserve allocations.
fn assert_accounting(fx: &Fx) {
    let info = fx.pool.get_pool();
    let mut limits = 0;
    let mut outstanding = 0;
    let mut consumed = 0;
    for agent in fx.pool.list_agents().iter() {
        let rec = fx.pool.get_agent(&agent);
        assert!(rec.drawn >= 0 && rec.drawn <= rec.draw_limit);
        consumed += rec.settled_spent;
        if rec.status != Status::Closed {
            limits += rec.draw_limit;
            outstanding += rec.drawn;
        } else {
            assert_eq!(rec.drawn, 0);
        }
    }
    assert_eq!(info.sum_limits, limits);
    assert_eq!(info.settled_spent, consumed);
    assert!(info.locked >= limits);
    assert!(info.balance >= info.locked - limits);
    assert_eq!(info.balance + outstanding, info.locked);
}

#[test]
fn close_after_partial_spend_releases_only_unused_funding() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    let spent = 2_000_000;
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&agent, &fx.prov, &spent);
    // Closing needs only the owner's approval, not the agent's key.
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr, fn_name: "close",
            args: (agent.clone(), fx.owner.clone()).into_val(&fx.e), sub_invokes: &[],
        },
    }]);
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(fx.e.auths().len(), 1);
    assert_eq!(fx.e.auths()[0].0, fx.owner);
    assert_eq!(fx.pool.get_agent(&agent).settled_spent, spent);
    assert_eq!(fx.pool.get_pool().locked, LOCK - spent);
    assert_eq!(fx.pool.get_pool().sum_limits, 0);
    assert_eq!(bal(&fx, &agent), 0);
    assert_accounting(&fx);
    fx.e.mock_all_auths();
    fx.pool.withdraw(&(LOCK - spent));
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
    assert_accounting(&fx);
}

#[test]
fn return_unused_then_close_records_consumption_once() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&agent, &fx.prov, &2_000_000);
    fx.pool.revoke(&agent, &fx.owner);
    fx.pool.return_funds(&agent, &fx.owner, &3_000_000);
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(fx.pool.get_pool().settled_spent, 2_000_000);
    let info = fx.pool.get_pool();
    assert!(fx.pool.try_close(&agent, &fx.owner).is_err());
    assert_eq!(fx.pool.get_pool(), info);
    assert_accounting(&fx);
}

#[test]
fn fully_spent_agent_cannot_reallocate_consumed_money() {
    let fx = setup();
    fx.pool.fund(&LIMIT);
    let agent = fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &LIMIT, &covenant(&fx));
    fx.pool.draw(&agent, &LIMIT);
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&agent, &fx.prov, &LIMIT);
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(fx.pool.get_pool().locked, 0);
    assert!(fx.pool.try_create_agent(&BytesN::<32>::random(&fx.e), &1, &covenant(&fx)).is_err());
    assert!(fx.pool.try_withdraw(&1).is_err());
    assert_accounting(&fx);
}

#[test]
fn closing_one_agent_preserves_another_agents_backing() {
    let fx = setup();
    fx.pool.fund(&(2 * LIMIT));
    let a = fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &LIMIT, &covenant(&fx));
    let b = fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &LIMIT, &covenant(&fx));
    fx.pool.draw(&a, &LIMIT);
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&a, &fx.prov, &2_000_000);
    fx.pool.close(&a, &fx.owner);
    fx.pool.withdraw(&3_000_000);
    assert!(fx.pool.try_withdraw(&1).is_err());
    fx.pool.draw(&b, &LIMIT);
    assert_eq!(bal(&fx, &b), LIMIT);
    assert_accounting(&fx);
    fx.pool.close(&b, &fx.owner);
    fx.pool.withdraw(&LIMIT);
    assert_accounting(&fx);
}

#[test]
fn closure_credits_surplus_and_later_refunds() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    token::StellarAssetClient::new(&fx.e, &fx.usdc).mint(&agent, &1_000_000);
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(fx.pool.get_pool().locked, LOCK + 1_000_000);
    token::StellarAssetClient::new(&fx.e, &fx.usdc).mint(&agent, &2_000_000);
    fx.pool.return_funds(&agent, &fx.owner, &2_000_000);
    assert_eq!(fx.pool.get_pool().locked, LOCK + 3_000_000);
    assert_accounting(&fx);
}

#[test]
fn direct_pool_deposits_and_unattributed_returns_do_not_strand_cash() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    let token = token::TokenClient::new(&fx.e, &fx.usdc);
    // A raw transfer is a pool deposit; use return_funds to also reconcile
    // the agent's outstanding advance. Either route must leave cash usable.
    token.transfer(&agent, &fx.pool_addr, &LIMIT);
    token.transfer(&fx.owner, &fx.pool_addr, &1_000_000);
    assert_accounting(&fx);
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(fx.pool.get_pool().locked, LOCK + 1_000_000);
    fx.pool.withdraw(&(LOCK + 1_000_000));
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
    assert_accounting(&fx);
}

#[test]
fn failed_recovery_rolls_back_closure_and_revocation() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    token::TokenClient::new(&fx.e, &fx.usdc).approve(&agent, &fx.pool_addr, &0, &10_000);
    let before = fx.pool.get_pool();
    assert!(fx.pool.try_close(&agent, &fx.owner).is_err());
    assert_eq!(fx.pool.get_pool(), before);
    assert_eq!(fx.pool.get_agent(&agent).status, Status::Active);
    assert!(!CovenantPolicyContractClient::new(&fx.e, &fx.policy).get_covenant(&agent).revoked);
    assert_accounting(&fx);
}

#[test]
fn close_rejects_stranger_and_missing_owner_signature() {
    let fx = setup();
    let agent = funded_agent(&fx);
    assert!(fx.pool.try_close(&agent, &Address::generate(&fx.e)).is_err());
    fx.e.mock_auths(&[]);
    assert!(fx.pool.try_close(&agent, &fx.owner).is_err());
    assert_eq!(fx.pool.get_agent(&agent).status, Status::Active);
}

#[test]
fn expiry_blocks_new_draws_and_delegation_but_allows_recovery() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &1_000_000);
    fx.e.ledger().set_sequence_number(10_000);
    assert_eq!(fx.pool.try_draw(&agent, &1), Err(Ok(soroban_sdk::Error::from_contract_error(16))));
    assert!(fx.pool.try_delegate(&agent, &BytesN::<32>::random(&fx.e), &1, &child_covenant(&fx)).is_err());
    assert!(fx.pool.try_create_agent(&BytesN::<32>::random(&fx.e), &1, &covenant(&fx)).is_err());
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(bal(&fx, &agent), 0);
    assert_accounting(&fx);
}

#[test]
fn dispute_records_and_owner_resolves() {
    let fx = setup();
    let agent = funded_agent(&fx);
    let ev = BytesN::<32>::random(&fx.e);
    fx.pool.dispute(&agent, &agent, &ev);
    let d = fx.pool.get_agent(&agent).dispute;
    assert_eq!(d.len(), 1);
    assert_eq!(d.get(0).unwrap().by, agent);
    assert_eq!(d.get(0).unwrap().outcome, None);
    fx.pool.resolve_dispute(&agent, &1);
    assert_eq!(fx.pool.get_agent(&agent).dispute.get(0).unwrap().outcome, Some(1));
}

#[test]
fn return_funds_allowed_after_revoke() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    fx.pool.revoke(&agent, &fx.owner);
    fx.pool.return_funds(&agent, &fx.owner, &LIMIT);
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK);
    assert_eq!(fx.pool.get_agent(&agent).drawn, 0);
}

// ---------------------------------------------------------------- delegation (Task 7)

fn parent_with_limit(fx: &Fx, limit: i128) -> Address {
    fx.pool.fund(&LOCK);
    fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &limit, &covenant(fx))
}

fn child_covenant(fx: &Fx) -> CovenantParams {
    let mut c = covenant(fx);
    c.provider_per_transfer_cap = 1_000_000;
    c.provider_total_cap = 2_000_000;
    c.expiry = 5_000;
    c
}

#[test]
fn delegate_carves_limit_from_parent() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let child = fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &4_000_000, &child_covenant(&fx));
    assert_eq!(fx.pool.get_agent(&parent).draw_limit, 6_000_000);
    let c = fx.pool.get_agent(&child);
    assert_eq!(c.draw_limit, 4_000_000);
    assert_eq!(c.parent, Some(parent.clone()));
    assert_eq!(fx.pool.get_agent(&parent).children, vec![&fx.e, child.clone()]);
    assert_eq!(fx.pool.get_pool().sum_limits, 10_000_000);
    assert_eq!(fx.pool.get_pool().agent_count, 2);
    // child can draw from the pool
    fx.pool.draw(&child, &4_000_000);
    assert_eq!(bal(&fx, &child), 4_000_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn delegate_rejects_over_parent_remaining() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    fx.pool.draw(&parent, &7_000_000);
    fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &4_000_000, &child_covenant(&fx));
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn delegate_rejects_payee_not_in_parent() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let mut c = child_covenant(&fx);
    c.providers = vec![&fx.e, Address::generate(&fx.e)];
    fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &1_000_000, &c);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn delegate_rejects_cap_above_parent() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let mut c = child_covenant(&fx);
    c.provider_per_transfer_cap = 2_000_001;
    fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &1_000_000, &c);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn delegate_rejects_expiry_after_parent() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let mut c = child_covenant(&fx);
    c.expiry = 10_001;
    fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &1_000_000, &c);
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn delegate_requires_parent_auth() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke { contract: &fx.pool_addr, fn_name: "delegate", args: Vec::new(&fx.e), sub_invokes: &[] },
    }]);
    fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &1_000_000, &child_covenant(&fx));
}

#[test]
fn revoke_parent_revokes_children() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let child = fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &4_000_000, &child_covenant(&fx));
    fx.pool.revoke(&parent, &fx.owner);
    assert_eq!(fx.pool.get_agent(&child).status, Status::Revoked);
    assert!(CovenantPolicyContractClient::new(&fx.e, &fx.policy).get_covenant(&child).revoked);
}

#[test]
fn close_child_returns_limit_to_parent() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let child = fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &4_000_000, &child_covenant(&fx));
    fx.pool.close(&child, &parent);
    assert_eq!(fx.pool.get_agent(&child).status, Status::Closed);
    assert_eq!(fx.pool.get_agent(&parent).draw_limit, 10_000_000);
    assert_eq!(fx.pool.get_pool().sum_limits, 10_000_000);
}

#[test]
fn child_consumption_is_not_returned_to_parent_as_spendable_budget() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let child = fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &4_000_000, &child_covenant(&fx));
    fx.pool.draw(&child, &4_000_000);
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&child, &fx.prov, &1_000_000);
    // A parent cannot be closed while its child's allocation is live.
    assert!(fx.pool.try_close(&parent, &fx.owner).is_err());
    fx.pool.close(&child, &parent);
    assert_eq!(fx.pool.get_agent(&parent).draw_limit, 9_000_000);
    assert_eq!(fx.pool.get_pool().sum_limits, 9_000_000);
    assert_eq!(fx.pool.get_pool().locked, LOCK - 1_000_000);
    assert_accounting(&fx);
    fx.pool.draw(&parent, &9_000_000);
    fx.pool.close(&parent, &fx.owner);
    assert_eq!(fx.pool.get_pool().settled_spent, 1_000_000);
    assert_accounting(&fx);
}

#[test]
fn parent_can_revoke_own_child() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let child = fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &4_000_000, &child_covenant(&fx));
    fx.pool.revoke(&child, &parent);
    assert_eq!(fx.pool.get_agent(&child).status, Status::Revoked);
    assert_eq!(fx.pool.get_agent(&parent).status, Status::Active);
}

// ---------------------------------------------------------------- signed e2e (Task 9)
//
// No mocked auth: the agent's ed25519 key signs an OpenZeppelin AuthPayload
// over the AuthDigestPreimage digest, exactly as the off-chain runtime will.
// Helper construction follows OpenZeppelin stellar-contracts v0.8.0,
// packages/accounts/src/smart_account/test/auth_entries.rs.

mod e2e {
    use super::*;
    use ed25519_dalek::{Signer as Ed25519Signer, SigningKey};
    use soroban_sdk::{
        map,
        xdr::{
            Hash as XdrHash, HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs,
            Limits, ScVal, SorobanAddressCredentials, SorobanAuthorizationEntry,
            SorobanAuthorizedFunction, SorobanAuthorizedInvocation, SorobanCredentials, VecM, WriteXdr,
        },
        Bytes, TryFromVal, Val,
    };
    use stellar_accounts::smart_account::{AuthDigestPreimage, AuthPayload, Signer};

    const NONCE: i64 = 1;
    const EXPIRATION_LEDGER: u32 = 100;
    const RULE_ID: u32 = 0;
    const SECRET_KEY: [u8; 32] = [
        157, 97, 177, 157, 239, 253, 90, 96, 186, 132, 74, 244, 146, 236, 44, 196, 68, 73, 197, 105,
        123, 50, 105, 25, 112, 59, 172, 3, 28, 174, 127, 96,
    ];

    fn to_scval<T: IntoVal<Env, Val>>(e: &Env, value: T) -> ScVal {
        ScVal::try_from_val(e, &value.into_val(e)).unwrap()
    }

    fn contract_fn(contract: &Address, name: &str, args: std::vec::Vec<ScVal>) -> SorobanAuthorizedInvocation {
        SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address: contract.into(),
                function_name: name.try_into().unwrap(),
                args: args.try_into().unwrap(),
            }),
            sub_invocations: VecM::default(),
        }
    }

    fn signature_payload(e: &Env, nonce: i64, invocation: &SorobanAuthorizedInvocation) -> BytesN<32> {
        let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
            network_id: XdrHash(e.ledger().get().network_id),
            nonce,
            signature_expiration_ledger: EXPIRATION_LEDGER,
            invocation: invocation.clone(),
        });
        let xdr = preimage.to_xdr(Limits::none()).unwrap();
        e.crypto().sha256(&Bytes::from_slice(e, &xdr)).to_bytes()
    }

    /// Builds the agent account's auth entry for `root_invocation`, signed by `key`.
    fn signed_entry(e: &Env, account: &Address, signer: &Signer, key: &SigningKey, root_invocation: SorobanAuthorizedInvocation) -> SorobanAuthorizationEntry {
        signed_entry_nonce(e, account, signer, key, NONCE, root_invocation)
    }

    fn signed_entry_nonce(e: &Env, account: &Address, signer: &Signer, key: &SigningKey, nonce: i64, root_invocation: SorobanAuthorizedInvocation) -> SorobanAuthorizationEntry {
        let preimage = AuthDigestPreimage {
            account: account.clone(),
            signature_payload: signature_payload(e, nonce, &root_invocation),
            context_rule_ids: vec![e, RULE_ID],
        };
        let digest = preimage.digest(e);
        let sig = Bytes::from_array(e, &key.sign(&digest.to_array()).to_bytes());
        let payload = AuthPayload { signers: map![e, (signer.clone(), sig)], context_rule_ids: vec![e, RULE_ID] };
        SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: account.into(),
                nonce,
                signature_expiration_ledger: EXPIRATION_LEDGER,
                signature: to_scval(e, payload),
            }),
            root_invocation,
        }
    }

    struct Signed {
        fx: Fx,
        agent: Address,
        signer: Signer,
        key: SigningKey,
    }

    /// Pool funded, agent created with the test key, draw limit drawn into the account.
    fn signed_setup() -> Signed {
        let fx = setup();
        let key = SigningKey::from_bytes(&SECRET_KEY);
        let pubkey = BytesN::from_array(&fx.e, key.verifying_key().as_bytes());
        fx.pool.fund(&LOCK);
        let agent = fx.pool.create_agent(&pubkey, &LIMIT, &covenant(&fx));
        fx.pool.draw(&agent, &LIMIT);
        let signer = Signer::External(fx.verifier.clone(), Bytes::from_array(&fx.e, key.verifying_key().as_bytes()));
        Signed { fx, agent, signer, key }
    }

    fn transfer_with_signature(s: &Signed, to: &Address, amount: i128) -> Result<(), ()> {
        let e = &s.fx.e;
        let inv = contract_fn(
            &s.fx.usdc,
            "transfer",
            std::vec![to_scval(e, s.agent.clone()), to_scval(e, to.clone()), to_scval(e, amount)],
        );
        e.set_auths(&[signed_entry(e, &s.agent, &s.signer, &s.key, inv)]);
        token::TokenClient::new(e, &s.fx.usdc).try_transfer(&s.agent, to, &amount).map(|_| ()).map_err(|_| ())
    }

    #[test]
    fn signed_transfer_to_provider_succeeds() {
        let s = signed_setup();
        assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_ok());
        assert_eq!(bal(&s.fx, &s.fx.prov), 1_000_000);
        let st = CovenantPolicyContractClient::new(&s.fx.e, &s.fx.policy).get_covenant(&s.agent);
        assert_eq!(st.provider_spent, 1_000_000);
    }

    #[test]
    fn signed_transfer_to_stranger_fails() {
        let s = signed_setup();
        let stranger = Address::generate(&s.fx.e);
        assert!(transfer_with_signature(&s, &stranger, 1_000_000).is_err());
        assert_eq!(bal(&s.fx, &stranger), 0);
    }

    #[test]
    fn signed_transfer_with_wrong_key_fails() {
        let mut s = signed_setup();
        s.key = SigningKey::from_bytes(&[9u8; 32]);
        assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_err());
        assert_eq!(bal(&s.fx, &s.fx.prov), 0);
    }

    #[test]
    fn signed_transfer_over_cap_fails() {
        let s = signed_setup();
        assert!(transfer_with_signature(&s, &s.fx.prov, 2_000_001).is_err());
        assert_eq!(bal(&s.fx, &s.fx.prov), 0);
    }

    #[test]
    fn signed_payment_then_owner_closure_recovers_and_settles() {
        let s = signed_setup();
        assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_ok());
        s.fx.e.mock_auths(&[MockAuth {
            address: &s.fx.owner,
            invoke: &MockAuthInvoke {
                contract: &s.fx.pool_addr, fn_name: "close",
                args: (s.agent.clone(), s.fx.owner.clone()).into_val(&s.fx.e), sub_invokes: &[],
            },
        }]);
        s.fx.pool.close(&s.agent, &s.fx.owner);
        assert_eq!(s.fx.pool.get_agent(&s.agent).settled_spent, 1_000_000);
        assert_eq!(s.fx.pool.get_pool().locked, LOCK - 1_000_000);
        assert_accounting(&s.fx);
    }

    #[test]
    fn closed_pool_agents_cannot_spend_late_deposits_with_a_valid_signature() {
        let s = signed_setup();
        let e = &s.fx.e;
        s.fx.pool.close(&s.agent, &s.fx.owner);
        e.mock_auths(&[MockAuth {
            address: &s.fx.owner,
            invoke: &MockAuthInvoke {
                contract: &s.fx.pool_addr, fn_name: "close_pool", args: ().into_val(e), sub_invokes: &[],
            },
        }]);
        s.fx.pool.close_pool();
        e.mock_all_auths();
        token::StellarAssetClient::new(e, &s.fx.usdc).mint(&s.agent, &1_000_000);
        // Fresh nonce and valid signer; rejection cannot be explained by replay
        // or lack of balance. The closed agent's covenant remains revoked.
        assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_err());
        assert_eq!(bal(&s.fx, &s.agent), 1_000_000);
        assert_eq!(bal(&s.fx, &s.fx.prov), 0);
        assert!(s.fx.pool.get_pool().closed);
    }

    #[test]
    fn settlement_request_blocks_signed_spending() {
        let s = signed_setup();
        let e = &s.fx.e;
        e.set_auths(&[pool_call_with_signature(&s, 10, "settle", std::vec![to_scval(e, s.agent.clone())])]);
        s.fx.pool.settle(&s.agent);
        assert!(transfer_with_signature(&s, &s.fx.prov, 1_000_000).is_err());
        assert_eq!(bal(&s.fx, &s.agent), LIMIT);
    }

    /// Signs a call on the pool from the agent account.
    fn pool_call_with_signature(s: &Signed, nonce: i64, fn_name: &str, args: std::vec::Vec<ScVal>) -> SorobanAuthorizationEntry {
        let inv = contract_fn(&s.fx.pool_addr, fn_name, args);
        signed_entry_nonce(&s.fx.e, &s.agent, &s.signer, &s.key, nonce, inv)
    }

    #[test]
    fn signed_parent_revokes_and_closes_child() {
        let s = signed_setup();
        let e = &s.fx.e;
        // parent returns its draw (mocked), delegates (mocked), then SIGNS revoke + close of the child
        s.fx.pool.return_funds(&s.agent, &s.agent, &LIMIT);
        let child = s.fx.pool.delegate(&s.agent, &BytesN::<32>::random(e), &1_000_000, &{
            let mut c = covenant(&s.fx); c.provider_per_transfer_cap = 1_000_000; c.provider_total_cap = 1_000_000; c.expiry = 5_000; c
        });
        e.set_auths(&[pool_call_with_signature(&s, 1, "revoke", std::vec![to_scval(e, child.clone()), to_scval(e, s.agent.clone())])]);
        s.fx.pool.revoke(&child, &s.agent);
        assert_eq!(s.fx.pool.get_agent(&child).status, Status::Revoked);
        e.set_auths(&[pool_call_with_signature(&s, 2, "close", std::vec![to_scval(e, child.clone()), to_scval(e, s.agent.clone())])]);
        s.fx.pool.close(&child, &s.agent);
        assert_eq!(s.fx.pool.get_agent(&child).status, Status::Closed);
    }

    #[test]
    fn signed_return_funds_after_revoke() {
        let s = signed_setup();
        let e = &s.fx.e;
        s.fx.pool.revoke(&s.agent, &s.fx.owner);
        e.set_auths(&[pool_call_with_signature(&s, 1, "return_funds", std::vec![to_scval(e, s.agent.clone()), to_scval(e, s.agent.clone()), to_scval(e, LIMIT)])]);
        s.fx.pool.return_funds(&s.agent, &s.agent, &LIMIT);
        assert_eq!(s.fx.pool.get_agent(&s.agent).drawn, 0);
        assert_eq!(bal(&s.fx, &s.fx.pool_addr), LOCK);
    }

    #[test]
    fn signed_add_context_rule_fails() {
        use soroban_sdk::{Map, String};
        let s = signed_setup();
        let e = &s.fx.e;
        let name = String::from_str(e, "escape");
        let ctype = account_wasm::ContextRuleType::Default;
        let signers = vec![e, account_wasm::Signer::Delegated(s.fx.owner.clone())];
        let policies: Map<Address, Val> = Map::new(e);
        let valid: Option<u32> = None;
        let args = std::vec![
            to_scval(e, ctype.clone()),
            to_scval(e, name.clone()),
            to_scval(e, valid),
            to_scval(e, signers.clone()),
            to_scval(e, policies.clone()),
        ];
        let inv = contract_fn(&s.agent, "add_context_rule", args);
        e.set_auths(&[signed_entry(e, &s.agent, &s.signer, &s.key, inv)]);
        let acct = account_wasm::Client::new(e, &s.agent);
        assert!(acct.try_add_context_rule(&ctype, &name, &valid, &signers, &policies).is_err());
        assert_eq!(acct.get_context_rules_count(), 1);
    }
}

// ---------------------------------------------------------------- review fix pass

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn close_twice_rejected() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.close(&agent, &fx.owner);
    fx.pool.close(&agent, &fx.owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn amend_closed_rejected() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.close(&agent, &fx.owner);
    fx.pool.amend(&agent, &1, &amendment(10_000));
}

#[test]
fn close_revokes_covenant() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.close(&agent, &fx.owner);
    assert!(CovenantPolicyContractClient::new(&fx.e, &fx.policy).get_covenant(&agent).revoked);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn delegate_rejects_dropping_amount_arg() {
    use kovan_covenant_policy::CallRule;
    use soroban_sdk::symbol_short;
    let fx = setup();
    fx.pool.fund(&LOCK);
    let pinger = Address::generate(&fx.e);
    let mut pc = covenant(&fx);
    pc.calls = vec![&fx.e, CallRule { contract: pinger.clone(), fn_name: symbol_short!("ping"), amount_arg: Some(1), amount_cap: 10 }];
    let parent = fx.pool.create_agent(&BytesN::<32>::random(&fx.e), &10_000_000, &pc);
    let mut cc = child_covenant(&fx);
    cc.calls = vec![&fx.e, CallRule { contract: pinger, fn_name: symbol_short!("ping"), amount_arg: None, amount_cap: 10 }];
    fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &1_000_000, &cc);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn delegate_rejects_more_than_max_children() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    for _ in 0..17 {
        fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &1, &child_covenant(&fx));
    }
}

#[test]
fn revoke_parent_after_child_already_revoked() {
    let fx = setup();
    let parent = parent_with_limit(&fx, 10_000_000);
    let child = fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &4_000_000, &child_covenant(&fx));
    fx.pool.revoke(&child, &parent);
    fx.pool.revoke(&parent, &fx.owner);
    assert_eq!(fx.pool.get_agent(&child).status, Status::Revoked);
    assert_eq!(fx.pool.get_agent(&parent).status, Status::Revoked);
}

// ---------------------------------------------------------------- events (console Task 1)

mod events {
    use super::*;
    use soroban_sdk::{testutils::Events as _, xdr::{ContractEventBody, ScVal}};

    /// (first topic as string, second topic as ScVal if any) of the last pool event.
    fn last_pool_event(fx: &Fx) -> (std::string::String, Option<ScVal>) {
        let evs = fx.e.events().all().filter_by_contract(&fx.pool_addr);
        let ev = evs.events().last().expect("no pool event").clone();
        let ContractEventBody::V0(v0) = ev.body;
        let topics: std::vec::Vec<ScVal> = v0.topics.to_vec();
        let name = match &topics[0] { ScVal::Symbol(s) => std::string::String::from_utf8(s.0.to_vec()).unwrap(), other => panic!("topic0 {:?}", other) };
        (name, topics.get(1).cloned())
    }

    fn addr_scval(fx: &Fx, a: &Address) -> ScVal {
        ScVal::try_from_val(&fx.e, &a.to_val()).unwrap()
    }

    #[test]
    fn fund_emits_funded() {
        let fx = setup();
        fx.pool.fund(&LOCK);
        assert_eq!(last_pool_event(&fx).0, "funded");
    }

    #[test]
    fn create_agent_emits_agent_created() {
        let fx = setup();
        let agent = funded_agent(&fx);
        let (name, topic1) = last_pool_event(&fx);
        assert_eq!(name, "agent_created");
        assert_eq!(topic1, Some(addr_scval(&fx, &agent)));
    }

    #[test]
    fn draw_emits_drawn() {
        let fx = setup();
        let agent = funded_agent(&fx);
        fx.pool.draw(&agent, &LIMIT);
        let (name, topic1) = last_pool_event(&fx);
        assert_eq!(name, "drawn");
        assert_eq!(topic1, Some(addr_scval(&fx, &agent)));
    }

    #[test]
    fn delegate_emits_delegated() {
        let fx = setup();
        let parent = parent_with_limit(&fx, 10_000_000);
        fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &1_000_000, &child_covenant(&fx));
        assert_eq!(last_pool_event(&fx).0, "delegated");
    }
}
