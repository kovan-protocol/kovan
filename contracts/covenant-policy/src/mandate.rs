//! Owner-approved grants and durable, atomic single-use payment receipts.
use kovan_covenant_types::{CovenantError as Error, MandateParams, MandateScope, MandateState, PaymentBinding, PaymentReceipt, PaymentTerms};
use soroban_sdk::{contractevent, contracttype, panic_with_error, vec, Address, BytesN, Env, Vec};
use crate::covenant::{get_state, COVENANT_EXTEND_AMOUNT, COVENANT_TTL_THRESHOLD};

#[contracttype]
pub enum MandateKey {
    Grant(Address, BytesN<32>),
    // Deliberately not scoped by mandate: a different mandate cannot replay an ID.
    Receipt(Address, BytesN<32>),
}

#[contractevent]
pub struct MandateCreated { #[topic] pub agent: Address, #[topic] pub mandate_id: BytesN<32>, pub params: MandateParams }
#[contractevent]
pub struct MandateRevoked { #[topic] pub agent: Address, #[topic] pub mandate_id: BytesN<32> }
#[contractevent]
pub struct MandatePayment { #[topic] pub agent: Address, #[topic] pub payment_id: BytesN<32>, pub receipt: PaymentReceipt }

fn bump(e: &Env, key: &MandateKey) {
    e.storage().persistent().extend_ttl(key, COVENANT_TTL_THRESHOLD, COVENANT_EXTEND_AMOUNT);
}
fn nonzero(e: &Env, value: &BytesN<32>) {
    if *value == BytesN::from_array(e, &[0; 32]) { panic_with_error!(e, Error::MandateInvalid); }
}

/// Zero/one record, avoiding Option<struct>'s ScVal ambiguity.
pub fn get(e: &Env, agent: &Address, id: &BytesN<32>) -> Vec<MandateState> {
    let key = MandateKey::Grant(agent.clone(), id.clone());
    match e.storage().persistent().get(&key) {
        Some(state) => { bump(e, &key); vec![e, state] }
        None => Vec::new(e),
    }
}
pub fn receipt(e: &Env, agent: &Address, id: &BytesN<32>) -> Vec<PaymentReceipt> {
    let key = MandateKey::Receipt(agent.clone(), id.clone());
    match e.storage().persistent().get(&key) {
        Some(value) => { bump(e, &key); vec![e, value] }
        None => Vec::new(e),
    }
}

pub fn create(e: &Env, agent: &Address, params: MandateParams) {
    let covenant = get_state(e, agent);
    covenant.params.pool.require_auth();
    if covenant.revoked { panic_with_error!(e, Error::Revoked); }
    nonzero(e, &params.id);
    nonzero(e, &params.intent_hash);
    if params.expiry <= e.ledger().sequence() || params.expiry > covenant.params.expiry {
        panic_with_error!(e, Error::Expired);
    }
    let key = MandateKey::Grant(agent.clone(), params.id.clone());
    if e.storage().persistent().has(&key) { panic_with_error!(e, Error::MandateExists); }
    let allowed = |payee: &Address, cap: i128| {
        let p = &covenant.params;
        if payee == agent || *payee == p.pool || cap <= 0 { panic_with_error!(e, Error::MandateInvalid); }
        let limit = if p.providers.contains(payee) { p.provider_per_transfer_cap }
            else if p.recipients.contains(payee) { p.recipient_per_transfer_cap }
            else { panic_with_error!(e, Error::PayeeNotAllowed) };
        if cap > limit { panic_with_error!(e, Error::PerTransferCapExceeded); }
    };
    match &params.scope {
        MandateScope::Budget(b) => {
            if b.payees.is_empty() || b.payees.len() > 16 || b.total_cap <= 0 || b.per_payment_cap > b.total_cap {
                panic_with_error!(e, Error::MandateInvalid);
            }
            let mut seen = Vec::new(e);
            for payee in b.payees.iter() {
                allowed(&payee, b.per_payment_cap);
                if seen.contains(&payee) { panic_with_error!(e, Error::MandateInvalid); }
                seen.push_back(payee);
            }
        }
        MandateScope::Exact(t) => {
            if t.asset != covenant.params.usdc { panic_with_error!(e, Error::WrongAsset); }
            nonzero(e, &t.reference);
            allowed(&t.payee, t.amount);
        }
    }
    let state = MandateState { params: params.clone(), spent: 0, payments: 0, revoked: false };
    e.storage().persistent().set(&key, &state);
    bump(e, &key);
    MandateCreated { agent: agent.clone(), mandate_id: params.id.clone(), params }.publish(e);
}

pub fn revoke(e: &Env, agent: &Address, id: &BytesN<32>) {
    get_state(e, agent).params.pool.require_auth();
    let mut state = get(e, agent, id).first().unwrap_or_else(|| panic_with_error!(e, Error::MandateMissing));
    state.revoked = true; // Terminal: replacement requires a fresh, owner-approved ID.
    let key = MandateKey::Grant(agent.clone(), id.clone());
    e.storage().persistent().set(&key, &state);
    bump(e, &key);
    MandateRevoked { agent: agent.clone(), mandate_id: id.clone() }.publish(e);
}

/// Only the smart account calls this, after verifying a signature that covers
/// `payment` AND the host's exact token invocation. No separate payment wrapper.
pub fn consume(e: &Env, agent: &Address, payment: PaymentBinding, terms: PaymentTerms, authorization_hash: BytesN<32>) {
    agent.require_auth();
    let covenant = get_state(e, agent);
    if covenant.revoked { panic_with_error!(e, Error::Revoked); }
    if terms.asset != covenant.params.usdc { panic_with_error!(e, Error::WrongAsset); }
    nonzero(e, &payment.payment_id);
    nonzero(e, &payment.reference);
    if terms.amount <= 0 || terms.reference != payment.reference { panic_with_error!(e, Error::PaymentMismatch); }
    let mut state = get(e, agent, &payment.mandate_id).first().unwrap_or_else(|| panic_with_error!(e, Error::MandateMissing));
    if state.revoked { panic_with_error!(e, Error::MandateRevoked); }
    let now = e.ledger().sequence();
    if now >= covenant.params.expiry || now >= state.params.expiry || now >= payment.valid_until || payment.valid_until > state.params.expiry {
        panic_with_error!(e, Error::Expired);
    }
    let receipt_key = MandateKey::Receipt(agent.clone(), payment.payment_id.clone());
    if e.storage().persistent().has(&receipt_key) { panic_with_error!(e, Error::PaymentConsumed); }
    let cap = match &state.params.scope {
        MandateScope::Budget(b) => {
            if !b.payees.contains(&terms.payee) || terms.amount > b.per_payment_cap { panic_with_error!(e, Error::PaymentMismatch); }
            b.total_cap
        }
        MandateScope::Exact(t) => {
            if *t != terms || state.payments != 0 { panic_with_error!(e, Error::PaymentMismatch); }
            t.amount
        }
    };
    state.spent = state.spent.checked_add(terms.amount).unwrap_or_else(|| panic_with_error!(e, Error::MandateExceeded));
    if state.spent > cap { panic_with_error!(e, Error::MandateExceeded); }
    state.payments = state.payments.checked_add(1).unwrap_or_else(|| panic_with_error!(e, Error::MandateExceeded));
    let key = MandateKey::Grant(agent.clone(), payment.mandate_id.clone());
    let receipt = PaymentReceipt { payment_id: payment.payment_id.clone(), mandate_id: payment.mandate_id, terms, authorization_hash, ledger: now };
    e.storage().persistent().set(&key, &state);
    e.storage().persistent().set(&receipt_key, &receipt);
    bump(e, &key);
    bump(e, &receipt_key);
    // A failed transfer rolls back both this event and all consumption/accounting.
    MandatePayment { agent: agent.clone(), payment_id: payment.payment_id, receipt }.publish(e);
}
