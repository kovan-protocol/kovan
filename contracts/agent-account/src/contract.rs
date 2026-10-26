//! The agent's smart account.
//!
//! Exactly one context rule is created, in the constructor: `Default`, one
//! `External` ed25519 signer (the agent's human-made key) and one policy (the
//! covenant). No rule covers calls to the account itself, so the rule set can
//! never be changed again: the covenant is frozen at creation.
//! Outgoing settlement-token payments additionally require an owner-approved
//! mandate and signed purchase binding; consumption is atomic with the transfer.
//!
//! The constructor also grants the pool an unlimited USDC allowance. The pool
//! uses it for `return_funds`, so the owner can pull money back without the
//! agent's signature. The call is auto-authorized because the account is the
//! direct invoker of the token contract.
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractclient, contractimpl, contracttype, panic_with_error, symbol_short,
    crypto::Hash,
    map, token, vec, Address, BytesN, Env, Map, String, TryFromVal, Val, Vec,
};
use kovan_covenant_types::{payment_payload, CovenantError, CovenantParams, PaymentBinding, PaymentTerms, MANDATE_VERSION};
use stellar_accounts::smart_account::{
    self, AuthDigestPreimage, AuthPayload, ContextRule, ContextRuleType, Signer, SmartAccount,
    SmartAccountError,
};

/// Allowance lifetime in ledgers (about 174 days at ~5 s/ledger), under the
/// network's maximum entry TTL.
const ALLOWANCE_LEDGERS: u32 = 3_000_000;

#[contracttype]
pub enum AccountKey { KovanConfigV1 }

#[contracttype]
#[derive(Clone)]
pub struct AccountConfig { pub pool: Address, pub usdc: Address, pub policy: Address }

#[contracttype]
#[derive(Clone)]
pub struct MandateAuthPayload { pub version: u32, pub auth: AuthPayload, pub payment: PaymentBinding }

#[contractclient(name = "MandatePolicyClient")]
pub trait MandatePolicy {
    fn mandate_version(e: Env) -> u32;
    fn consume_mandate(e: Env, smart_account: Address, payment: PaymentBinding, terms: PaymentTerms, authorization_hash: BytesN<32>);
}

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
        let params = CovenantParams::try_from_val(e, &covenant).unwrap_or_else(|_| panic_with_error!(e, CovenantError::MandateInvalid));
        if params.pool != pool || params.usdc != usdc || MandatePolicyClient::new(e, &policy).mandate_version() != MANDATE_VERSION {
            panic_with_error!(e, CovenantError::MandateInvalid);
        }
        e.storage().instance().set(&AccountKey::KovanConfigV1, &AccountConfig { pool: pool.clone(), usdc: usdc.clone(), policy: policy.clone() });
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

    pub fn mandate_version(_e: &Env) -> u32 { MANDATE_VERSION }

    pub fn recovery_version(_e: &Env) -> u32 { 1 }

    /// Only the immutable pool can renew its recovery allowance. No caller can
    /// choose a different spender, token, amount or destination. Works even
    /// after expiry/revocation and does not require the agent's key.
    pub fn renew_recovery(e: &Env) {
        let config: AccountConfig = e.storage().instance().get(&AccountKey::KovanConfigV1).unwrap();
        config.pool.require_auth();
        let live_until = e.ledger().sequence().checked_add(ALLOWANCE_LEDGERS)
            .unwrap_or_else(|| panic_with_error!(e, CovenantError::Expired));
        token::TokenClient::new(e, &config.usdc).approve(
            &e.current_contract_address(), &config.pool, &i128::MAX, &live_until,
        );
    }

    /// Read-only signing vector helper. A digest alone grants no authorization.
    pub fn mandate_auth_digest(e: &Env, signature_payload: BytesN<32>, payment: PaymentBinding) -> BytesN<32> {
        AuthDigestPreimage { account: e.current_contract_address(), signature_payload: payment_payload(e, &signature_payload, &payment).to_bytes(), context_rule_ids: vec![e, 0u32] }.digest(e)
    }
}

#[contractimpl]
impl CustomAccountInterface for KovanAgentAccount {
    type Error = SmartAccountError;
    // Legacy AuthPayload remains valid for lifecycle/recovery calls only.
    type Signature = Val;

    fn __check_auth(
        e: Env,
        signature_payload: Hash<32>,
        signatures: Val,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        let config: AccountConfig = e.storage().instance().get(&AccountKey::KovanConfigV1).unwrap();
        let account = e.current_contract_address();
        let mut outgoing: Option<(Address, i128)> = None;
        for context in auth_contexts.iter() {
            let Context::Contract(c) = context else { panic_with_error!(&e, CovenantError::NotAllowed) };
            // In particular, a caller cannot invoke consume_mandate directly,
            // pretending a transfer occurred, even if policy calls were allowlisted.
            if c.contract == config.policy || c.contract == account { panic_with_error!(&e, CovenantError::SelfCallForbidden); }
            if c.contract == config.usdc && c.fn_name == symbol_short!("transfer") {
                if c.args.len() != 3 { panic_with_error!(&e, CovenantError::PaymentMismatch); }
                let from = Address::try_from_val(&e, &c.args.get(0).unwrap()).unwrap_or_else(|_| panic_with_error!(&e, CovenantError::PaymentMismatch));
                let to = Address::try_from_val(&e, &c.args.get(1).unwrap()).unwrap_or_else(|_| panic_with_error!(&e, CovenantError::PaymentMismatch));
                let amount = i128::try_from_val(&e, &c.args.get(2).unwrap()).unwrap_or_else(|_| panic_with_error!(&e, CovenantError::PaymentMismatch));
                if from != account { panic_with_error!(&e, CovenantError::PaymentMismatch); }
                if to != config.pool { outgoing = Some((to, amount)); }
            }
        }
        if let Some((payee, amount)) = outgoing {
            // v1 supports one exact token payment, with no nested/batched actions.
            if auth_contexts.len() != 1 { panic_with_error!(&e, CovenantError::PaymentMismatch); }
            let payload = MandateAuthPayload::try_from_val(&e, &signatures).unwrap_or_else(|_| panic_with_error!(&e, CovenantError::MandateRequired));
            if payload.version != MANDATE_VERSION || payload.auth.context_rule_ids != vec![&e, 0u32] {
                panic_with_error!(&e, CovenantError::MandateInvalid);
            }
            let host_hash = signature_payload.to_bytes();
            let bound = payment_payload(&e, &host_hash, &payload.payment);
            smart_account::do_check_auth(&e, &bound, &payload.auth, &auth_contexts)?;
            let terms = PaymentTerms { asset: config.usdc, payee, amount, reference: payload.payment.reference.clone() };
            MandatePolicyClient::new(&e, &config.policy).consume_mandate(&account, &payload.payment, &terms, &host_hash);
            Ok(())
        } else {
            let payload = AuthPayload::try_from_val(&e, &signatures).unwrap_or_else(|_| panic_with_error!(&e, CovenantError::MandateInvalid));
            smart_account::do_check_auth(&e, &signature_payload, &payload, &auth_contexts)
        }
    }
}

#[contractimpl(contracttrait)]
impl SmartAccount for KovanAgentAccount {}
