//! The agent's smart account.
//!
//! Exactly one context rule is created, in the constructor: `Default`, one
//! `External` ed25519 signer (the agent's human-made key) and one policy (the
//! covenant). No rule covers calls to the account itself, so the rule set can
//! never be changed again: the covenant is frozen at creation.
//!
//! The constructor also grants the pool an unlimited USDC allowance. The pool
//! uses it for `return_funds`, so the owner can pull money back without the
//! agent's signature. The call is auto-authorized because the account is the
//! direct invoker of the token contract.
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    map, token, vec, Address, BytesN, Env, Map, String, Val, Vec,
};
use stellar_accounts::smart_account::{
    self, AuthDigestPreimage, AuthPayload, ContextRule, ContextRuleType, Signer, SmartAccount,
    SmartAccountError,
};

/// Allowance lifetime in ledgers (about 174 days at ~5 s/ledger), under the
/// network's maximum entry TTL.
const ALLOWANCE_LEDGERS: u32 = 3_000_000;

#[contract]
pub struct KovanAgentAccount;

#[contractimpl]
impl KovanAgentAccount {
    /// Creates the frozen covenant rule and grants the pool its allowance.
    pub fn __constructor(
        e: &Env,
        agent_pubkey: BytesN<32>,
        verifier: Address,
        policy: Address,
        covenant: Val,
        pool: Address,
        usdc: Address,
    ) {
        let signers: Vec<Signer> = vec![e, Signer::External(verifier, agent_pubkey.into())];
        smart_account::add_context_rule(
            e,
            &ContextRuleType::Default,
            &String::from_str(e, "covenant"),
            None,
            &signers,
            &map![e, (policy, covenant)],
        );

        let live_until = e.ledger().sequence() + ALLOWANCE_LEDGERS;
        token::TokenClient::new(e, &usdc).approve(
            &e.current_contract_address(),
            &pool,
            &i128::MAX,
            &live_until,
        );
    }

    /// The id of the covenant rule. Always 0: it is the only rule.
    pub fn covenant_rule_id(_e: &Env) -> u32 {
        0
    }
}

#[contractimpl]
impl CustomAccountInterface for KovanAgentAccount {
    type Error = SmartAccountError;
    type Signature = AuthPayload;

    fn __check_auth(
        e: Env,
        signature_payload: Hash<32>,
        signatures: AuthPayload,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        smart_account::do_check_auth(&e, &signature_payload, &signatures, &auth_contexts)
    }
}

#[contractimpl(contracttrait)]
impl SmartAccount for KovanAgentAccount {}
