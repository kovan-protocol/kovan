#![cfg(test)]
extern crate std;

use kovan_covenant_policy::{CovenantParams, CovenantPolicyContract, CovenantPolicyContractClient};
use kovan_ed25519_verifier::Ed25519VerifierContract;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    token, vec, Address, BytesN, Env, IntoVal, Map, String, Val, Vec,
};
use stellar_accounts::smart_account::ContextRuleType;

use crate::contract::{KovanAgentAccount, KovanAgentAccountClient};

struct Fx {
    e: Env,
    account: Address,
    pool: Address,
    usdc: Address,
    policy: Address,
}

fn setup() -> Fx {
    let e = Env::default();
    e.mock_all_auths();
    let pool = Address::generate(&e);
    let admin = Address::generate(&e);
    let usdc = e.register_stellar_asset_contract_v2(admin).address();
    let policy = e.register(CovenantPolicyContract, ());
    let verifier = e.register(Ed25519VerifierContract, ());
    let covenant = CovenantParams {
        pool: pool.clone(),
        usdc: usdc.clone(),
        providers: vec![&e, Address::generate(&e)],
        provider_per_transfer_cap: 2_000_000,
        provider_total_cap: 5_000_000,
        recipients: Vec::new(&e),
        recipient_per_transfer_cap: 0,
        recipient_total_cap: 0,
        calls: Vec::new(&e),
        expiry: 1_000,
    };
    let covenant_val: Val = covenant.into_val(&e);
    let pubkey: BytesN<32> = BytesN::random(&e);
    let account = e.register(
        KovanAgentAccount,
        (pubkey, verifier, policy.clone(), covenant_val, pool.clone(), usdc.clone()),
    );
    Fx { e, account, pool, usdc, policy }
}

#[test]
fn constructor_creates_single_default_rule() {
    let fx = setup();
    let c = KovanAgentAccountClient::new(&fx.e, &fx.account);
    assert_eq!(c.get_context_rules_count(), 1);
    let r = c.get_context_rule(&0);
    assert_eq!(r.context_type, ContextRuleType::Default);
    assert_eq!(r.name, String::from_str(&fx.e, "covenant"));
    assert_eq!(r.signers.len(), 1);
    assert_eq!(r.policies, vec![&fx.e, fx.policy.clone()]);
    assert_eq!(c.covenant_rule_id(), 0);
}

#[test]
fn constructor_grants_pool_allowance() {
    let fx = setup();
    let t = token::TokenClient::new(&fx.e, &fx.usdc);
    assert_eq!(t.allowance(&fx.account, &fx.pool), i128::MAX);
}

#[test]
fn constructor_installs_covenant() {
    let fx = setup();
    let p = CovenantPolicyContractClient::new(&fx.e, &fx.policy);
    let s = p.get_covenant(&fx.account);
    assert_eq!(s.params.pool, fx.pool);
    assert_eq!(s.rule_id, 0);
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn management_call_is_unauthorized() {
    let fx = setup();
    fx.e.set_auths(&[]); // drop mock_all_auths: real __check_auth runs with no entries
    let c = KovanAgentAccountClient::new(&fx.e, &fx.account);
    let policies: Map<Address, Val> = Map::new(&fx.e);
    c.add_context_rule(
        &ContextRuleType::Default,
        &String::from_str(&fx.e, "escape"),
        &None,
        &vec![&fx.e, stellar_accounts::smart_account::Signer::Delegated(Address::generate(&fx.e))],
        &policies,
    );
}

/// No mocked auth at all: the constructor's policy install and USDC approve
/// must pass because the account is the direct invoker of both contracts.
#[test]
fn constructor_needs_no_signatures() {
    let e = Env::default();
    let pool = Address::generate(&e);
    let admin = Address::generate(&e);
    let usdc = e.register_stellar_asset_contract_v2(admin).address();
    let policy = e.register(CovenantPolicyContract, ());
    let verifier = e.register(Ed25519VerifierContract, ());
    let covenant = CovenantParams {
        pool: pool.clone(),
        usdc: usdc.clone(),
        providers: Vec::new(&e),
        provider_per_transfer_cap: 0,
        provider_total_cap: 0,
        recipients: Vec::new(&e),
        recipient_per_transfer_cap: 0,
        recipient_total_cap: 0,
        calls: Vec::new(&e),
        expiry: 1_000,
    };
    let covenant_val: Val = covenant.into_val(&e);
    let account = e.register(
        KovanAgentAccount,
        (BytesN::<32>::random(&e), verifier, policy, covenant_val, pool.clone(), usdc.clone()),
    );
    assert_eq!(token::TokenClient::new(&e, &usdc).allowance(&account, &pool), i128::MAX);
}

/// Prints a fixed vector for the TypeScript AuthPayload builder to reproduce.
/// Run: cargo test -p kovan-agent-account digest_vector -- --nocapture
#[test]
fn digest_vector() {
    use stellar_accounts::smart_account::AuthDigestPreimage;
    let e = Env::default();
    let account = Address::from_str(&e, "CAS7ARNTLTRAD4WLYGIXC5EVMFZBETIQROJ2UWOJGU4QQY5XQT3K2LKJ");
    let preimage = AuthDigestPreimage {
        account,
        signature_payload: BytesN::from_array(&e, &[7u8; 32]),
        context_rule_ids: vec![&e, 0u32],
    };
    let d = preimage.digest(&e).to_array();
    let hex: std::string::String = d.iter().map(|b| std::format!("{:02x}", b)).collect();
    std::println!("DIGEST_VECTOR {}", hex);
    assert_eq!(d.len(), 32);
}
