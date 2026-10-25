use super::*;
use soroban_sdk::{testutils::Events as _, Event as _};

#[test]
fn close_pool_returns_cash_with_owner_auth_and_emits_final_event() {
    let fx = setup();
    fx.pool.fund(&LOCK);
    assert!(!fx.pool.get_pool().closed);
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr, fn_name: "close_pool", args: ().into_val(&fx.e), sub_invokes: &[],
        },
    }]);
    fx.pool.close_pool();
    assert_eq!(fx.e.auths().len(), 1);
    assert_eq!(fx.e.auths()[0].0, fx.owner);
    let expected = crate::events::PoolClosed { owner: fx.owner.clone(), returned: LOCK };
    assert!(fx.e.events().all().events().contains(&expected.to_xdr(&fx.e, &fx.pool_addr)));
    assert!(fx.pool.get_pool().closed);
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
    assert_eq!(bal(&fx, &fx.owner), 100_000_000);
    assert_eq!(fx.pool.get_pool().owner, fx.owner);
}

#[test]
fn close_pool_requires_owner_even_without_funds() {
    let fx = setup();
    fx.e.mock_auths(&[]);
    assert!(fx.pool.try_close_pool().is_err());
    let stranger = Address::generate(&fx.e);
    fx.e.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr, fn_name: "close_pool", args: ().into_val(&fx.e), sub_invokes: &[],
        },
    }]);
    assert!(fx.pool.try_close_pool().is_err());
    assert!(!fx.pool.get_pool().closed);
    fx.e.mock_all_auths();
    fx.pool.close_pool();
    assert!(fx.pool.get_pool().closed);
    assert_eq!(fx.pool.try_close_pool(), Err(Ok(soroban_sdk::Error::from_contract_error(17))));
}

#[test]
fn shutdown_requires_closed_agents_not_just_revocation_or_empty_wallets() {
    let fx = setup();
    let agent = funded_agent(&fx);
    assert_eq!(fx.pool.try_close_pool(), Err(Ok(soroban_sdk::Error::from_contract_error(18))));
    fx.pool.revoke(&agent, &fx.owner);
    assert!(fx.pool.try_close_pool().is_err());
    assert!(!fx.pool.get_pool().closed);
    fx.pool.close(&agent, &fx.owner);
    fx.pool.close_pool();
    assert!(fx.pool.get_pool().closed);
    assert_eq!(fx.pool.list_agents(), vec![&fx.e, agent.clone()]);
    assert_eq!(fx.pool.get_agent(&agent).status, Status::Closed);
}

#[test]
fn fully_spent_child_cannot_hide_zero_limit_open_parent() {
    let fx = setup();
    let parent = funded_agent(&fx);
    let child = fx.pool.delegate(&parent, &BytesN::<32>::random(&fx.e), &LIMIT, &child_covenant(&fx));
    fx.pool.draw(&child, &LIMIT);
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&child, &fx.prov, &LIMIT);
    fx.pool.close(&child, &fx.owner);
    assert_eq!(fx.pool.get_pool().sum_limits, 0);
    assert_eq!(fx.pool.try_close_pool(), Err(Ok(soroban_sdk::Error::from_contract_error(18))));
    fx.pool.close(&parent, &fx.owner);
    fx.pool.close_pool();
    assert_eq!(bal(&fx, &fx.owner), 100_000_000 - LIMIT);
    assert_eq!(fx.pool.get_pool().settled_spent, LIMIT);
    assert!(fx.pool.get_pool().closed);
}

#[test]
fn shutdown_blocks_reuse_but_preserves_late_refund_recovery() {
    let fx = setup();
    let agent = funded_agent(&fx);
    fx.pool.close(&agent, &fx.owner);
    fx.pool.close_pool();
    let closed = Err(Ok(soroban_sdk::Error::from_contract_error(17)));
    assert_eq!(fx.pool.try_fund(&1), closed);
    assert!(fx.pool.try_create_agent(&BytesN::<32>::random(&fx.e), &LIMIT, &covenant(&fx)).is_err());
    assert_eq!(fx.pool.try_draw(&agent, &1), closed);
    assert_eq!(fx.pool.try_amend(&agent, &LIMIT, &amendment(10_000)), closed);
    assert_eq!(fx.pool.try_revoke(&agent, &fx.owner), closed);
    assert_eq!(fx.pool.try_settle(&agent), closed);
    assert_eq!(fx.pool.try_close(&agent, &fx.owner), closed);
    assert_eq!(fx.pool.try_dispute(&agent, &fx.owner, &BytesN::<32>::random(&fx.e)), closed);
    assert_eq!(fx.pool.try_resolve_dispute(&agent, &1), closed);
    assert!(fx.pool.try_delegate(&agent, &BytesN::<32>::random(&fx.e), &1, &child_covenant(&fx)).is_err());
    let token = token::TokenClient::new(&fx.e, &fx.usdc);
    token.transfer(&fx.owner, &fx.pool_addr, &200);
    token.transfer(&fx.owner, &agent, &300);
    fx.pool.return_funds(&agent, &fx.owner, &300);
    fx.e.mock_auths(&[]);
    assert!(fx.pool.try_withdraw(&500).is_err());
    fx.e.mock_all_auths();
    fx.pool.withdraw(&500);
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
    assert_eq!(bal(&fx, &fx.owner), 100_000_000);
    assert!(fx.pool.get_pool().closed);
    assert_eq!(fx.pool.try_fund(&1), closed);
}

#[test]
fn failed_owner_refund_rolls_back_shutdown() {
    let fx = setup();
    fx.pool.fund(&LOCK);
    // Fill the owner's C-account to the SAC balance ceiling so the refund fails.
    token::StellarAssetClient::new(&fx.e, &fx.usdc).mint(&fx.owner, &(i128::MAX - bal(&fx, &fx.owner)));
    assert!(fx.pool.try_close_pool().is_err());
    assert!(!fx.pool.get_pool().closed);
    assert_eq!(bal(&fx, &fx.pool_addr), LOCK);
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&fx.owner, &fx.prov, &LOCK);
    fx.pool.close_pool();
    assert!(fx.pool.get_pool().closed);
    assert_eq!(bal(&fx, &fx.pool_addr), 0);
}
