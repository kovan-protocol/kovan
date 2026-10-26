use super::*;
use std::string::ToString;
use crate::storage::{MAX_DELEGATION_DEPTH, MAX_FAMILY_AGENTS};

#[test]
fn recovery_renews_expired_allowance_without_agent_signature() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    fx.pool.revoke(&agent, &fx.owner);
    fx.e.ledger().set_sequence_number(3_000_001);
    let token = token::TokenClient::new(&fx.e, &fx.usdc);
    assert_eq!(token.allowance(&agent, &fx.pool_addr), 0);
    fx.e.mock_auths(&[MockAuth { address: &fx.owner, invoke: &MockAuthInvoke {
        contract: &fx.pool_addr, fn_name: "return_funds",
        args: (&agent, &fx.owner, LIMIT).into_val(&fx.e), sub_invokes: &[],
    } }]);
    fx.pool.return_funds(&agent, &fx.owner, &LIMIT);
    assert_eq!(fx.e.auths().len(), 1);
    assert_eq!(fx.e.auths()[0].0, fx.owner);
    assert_eq!(bal(&fx, &agent), 0);
    assert_eq!(fx.pool.get_agent(&agent).drawn, 0);
    assert!(token.allowance(&agent, &fx.pool_addr) > 0);
}

#[test]
fn close_recovers_after_allowance_expiry() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.draw(&agent, &LIMIT);
    fx.e.ledger().set_sequence_number(3_000_001);
    fx.pool.close(&agent, &fx.owner);
    assert_eq!(bal(&fx, &agent), 0);
    assert_eq!(fx.pool.get_agent(&agent).status, Status::Closed);
}

#[test]
fn delegation_depth_is_bounded_and_failure_is_atomic() {
    let fx = setup();
    let root = funded_agent(&fx);
    let mut parent = root.clone();
    for _ in 0..MAX_DELEGATION_DEPTH {
        parent = fx.pool.delegate(&parent, &BytesN::random(&fx.e), &LIMIT, &covenant(&fx));
    }
    let before = fx.pool.get_pool();
    assert_eq!(fx.pool.try_delegate(&parent, &BytesN::random(&fx.e), &LIMIT, &covenant(&fx)),
        Err(Ok(soroban_sdk::Error::from_contract_error(30))));
    assert_eq!(fx.pool.get_pool(), before);
    fx.pool.revoke(&root, &fx.owner);
    assert_eq!(fx.pool.get_agent(&parent).status, Status::Revoked);
}

#[test]
fn largest_family_revokes_with_normal_resource_limits() {
    let wasm = std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/wasm32v1-none/release/kovan_pool.wasm")).unwrap();
    let policy_wasm = std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/wasm32v1-none/release/kovan_covenant_policy.wasm")).unwrap();
    let fx = setup_with_pool_wasm(Some(&wasm));
    fx.e.register_at(&fx.policy, policy_wasm.as_slice(), ());
    let root = funded_agent(&fx);
    // 1 root + 8 direct children + 8 grandchildren = the lifetime limit.
    let mut branch = root.clone();
    for i in 0..8 {
        fx.e.cost_estimate().budget().reset_default();
        let child = fx.pool.delegate(&root, &BytesN::random(&fx.e), &100, &covenant(&fx));
        if i == 0 { branch = child; }
    }
    for _ in 0..(MAX_FAMILY_AGENTS - 9) {
        fx.e.cost_estimate().budget().reset_default();
        fx.pool.delegate(&branch, &BytesN::random(&fx.e), &1, &covenant(&fx));
    }
    fx.e.cost_estimate().budget().reset_default();
    assert_eq!(fx.pool.try_delegate(&branch, &BytesN::random(&fx.e), &1, &covenant(&fx)),
        Err(Ok(soroban_sdk::Error::from_contract_error(29))));
    // A fresh host mirrors a separate transaction, without accumulated test
    // diagnostic/auth snapshots from all preceding deployments. Real WASM and
    // default resource limits remain enabled throughout.
    let e = Env::from_snapshot(fx.e.to_snapshot());
    let pool_addr = Address::from_str(&e, &fx.pool_addr.to_string().to_string());
    let owner = Address::from_str(&e, &fx.owner.to_string().to_string());
    let root = Address::from_str(&e, &root.to_string().to_string());
    let pool = KovanPoolClient::new(&e, &pool_addr);
    e.mock_auths(&[MockAuth { address: &owner, invoke: &MockAuthInvoke {
        contract: &pool_addr, fn_name: "revoke", args: (&root, &owner).into_val(&e), sub_invokes: &[],
    } }]);
    pool.revoke(&root, &owner);
    for agent in pool.list_agents().iter() {
        assert_eq!(pool.get_agent(&agent).status, Status::Revoked);
    }
}
