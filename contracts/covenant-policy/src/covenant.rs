//! Covenant types, storage and (later) enforcement.
//!
//! A covenant is attached to one agent smart account. It says what the
//! account may do: pay allowlisted providers and recipients within caps,
//! call allowlisted contracts, and talk to the pool. State is keyed by the
//! smart account address: one covenant per account.
use soroban_sdk::{
    auth::{Context, ContractContext},
    contracttype, panic_with_error, symbol_short, Address, Env, Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::smart_account::{ContextRule, Signer};

pub use kovan_covenant_types::{Amendment, CallRule, CovenantError, CovenantParams, CovenantState};

#[contracttype]
pub enum CovenantKey {
    State(Address),
}

const DAY_IN_LEDGERS: u32 = 17280;
pub const COVENANT_EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const COVENANT_TTL_THRESHOLD: u32 = COVENANT_EXTEND_AMOUNT - DAY_IN_LEDGERS;

/// Loads the covenant for `account`, extending its TTL. Panics with
/// [`CovenantError::NotInstalled`] when there is none.
pub fn get_state(e: &Env, account: &Address) -> CovenantState {
    let key = CovenantKey::State(account.clone());
    e.storage()
        .persistent()
        .get(&key)
        .inspect(|_| {
            e.storage().persistent().extend_ttl(&key, COVENANT_TTL_THRESHOLD, COVENANT_EXTEND_AMOUNT);
        })
        .unwrap_or_else(|| panic_with_error!(e, CovenantError::NotInstalled))
}

pub fn set_state(e: &Env, account: &Address, state: &CovenantState) {
    let key = CovenantKey::State(account.clone());
    e.storage().persistent().set(&key, state);
    e.storage().persistent().extend_ttl(&key, COVENANT_TTL_THRESHOLD, COVENANT_EXTEND_AMOUNT);
}

pub fn has_state(e: &Env, account: &Address) -> bool {
    e.storage().persistent().has(&CovenantKey::State(account.clone()))
}

// ################## LIFECYCLE ##################

/// Installs the covenant. Panics with [`CovenantError::AlreadyInstalled`]
/// if the account already has one: a covenant is written once.
pub fn install(e: &Env, params: &CovenantParams, context_rule: &ContextRule, smart_account: &Address) {
    smart_account.require_auth();
    if has_state(e, smart_account) {
        panic_with_error!(e, CovenantError::AlreadyInstalled);
    }
    let state = CovenantState {
        params: params.clone(),
        rule_id: context_rule.id,
        provider_spent: 0,
        recipient_spent: 0,
        revoked: false,
    };
    set_state(e, smart_account, &state);
}

/// Covenants are not removable. Always panics with [`CovenantError::NotAllowed`].
pub fn uninstall(e: &Env, _context_rule: &ContextRule, _smart_account: &Address) {
    panic_with_error!(e, CovenantError::NotAllowed)
}

/// Pool-only: freezes or unfreezes spend and calls.
pub fn set_revoked(e: &Env, smart_account: &Address, revoked: bool) {
    let mut state = get_state(e, smart_account);
    state.params.pool.require_auth();
    state.revoked = revoked;
    set_state(e, smart_account, &state);
}

/// Pool-only: changes the numeric limits. Expiry may not be moved into the past.
pub fn amend(e: &Env, smart_account: &Address, a: &Amendment) {
    let mut state = get_state(e, smart_account);
    state.params.pool.require_auth();
    if a.expiry < e.ledger().sequence() {
        panic_with_error!(e, CovenantError::Expired);
    }
    state.params.provider_per_transfer_cap = a.provider_per_transfer_cap;
    state.params.provider_total_cap = a.provider_total_cap;
    state.params.recipient_per_transfer_cap = a.recipient_per_transfer_cap;
    state.params.recipient_total_cap = a.recipient_total_cap;
    state.params.expiry = a.expiry;
    set_state(e, smart_account, &state);
}

// ################## ENFORCEMENT ##################

/// The covenant check. Called by the smart account for every authorized
/// context. Panics with a [`CovenantError`] when the context is outside the
/// covenant; returns when it is inside, after recording spend.
pub fn enforce(
    e: &Env,
    context: &Context,
    authenticated_signers: &Vec<Signer>,
    _context_rule: &ContextRule,
    smart_account: &Address,
) {
    smart_account.require_auth();
    if authenticated_signers.is_empty() {
        panic_with_error!(e, CovenantError::NoSigner);
    }
    let mut state = get_state(e, smart_account);
    let Context::Contract(ContractContext { contract, fn_name, args }) = context else {
        panic_with_error!(e, CovenantError::NotAllowed)
    };

    if contract == smart_account {
        panic_with_error!(e, CovenantError::SelfCallForbidden);
    }
    // The way back to the pool stays open after expiry and after revocation:
    // `return_funds` / `dispute` on the pool, and a USDC transfer to the pool.
    if *contract == state.params.pool {
        enforce_pool_call(e, fn_name, state.revoked);
        return;
    }
    if *contract == state.params.usdc {
        enforce_transfer(e, &mut state, fn_name, args);
        set_state(e, smart_account, &state);
        return;
    }
    if state.revoked {
        panic_with_error!(e, CovenantError::Revoked);
    }
    enforce_listed_call(e, &state, contract, fn_name, args);
}

/// Pool functions an agent may always call, even when revoked.
const POOL_FNS_ALWAYS: [&str; 2] = ["return_funds", "dispute"];
/// Pool functions an agent may call while its covenant is live.
const POOL_FNS_ACTIVE: [&str; 5] = ["draw", "settle", "delegate", "revoke", "close"];

fn enforce_pool_call(e: &Env, fn_name: &Symbol, revoked: bool) {
    if POOL_FNS_ALWAYS.iter().any(|n| *fn_name == Symbol::new(e, n)) {
        return;
    }
    if !POOL_FNS_ACTIVE.iter().any(|n| *fn_name == Symbol::new(e, n)) {
        panic_with_error!(e, CovenantError::CallNotAllowed)
    }
    if revoked {
        panic_with_error!(e, CovenantError::Revoked)
    }
}

fn enforce_transfer(e: &Env, state: &mut CovenantState, fn_name: &Symbol, args: &Vec<Val>) {
    if *fn_name != symbol_short!("transfer") {
        panic_with_error!(e, CovenantError::NotAllowed);
    }
    let to: Address = args
        .get(1)
        .and_then(|v| Address::try_from_val(e, &v).ok())
        .unwrap_or_else(|| panic_with_error!(e, CovenantError::PayeeNotAllowed));
    let amount: i128 = args
        .get(2)
        .and_then(|v| i128::try_from_val(e, &v).ok())
        .unwrap_or_else(|| panic_with_error!(e, CovenantError::NotAllowed));
    if amount <= 0 {
        panic_with_error!(e, CovenantError::AmountNotPositive);
    }
    // Returning funds to the pool is always allowed, even after expiry or revocation.
    if to == state.params.pool {
        return;
    }
    if state.revoked {
        panic_with_error!(e, CovenantError::Revoked);
    }
    check_expiry(e, state.params.expiry);
    let p = &state.params;
    if p.providers.contains(&to) {
        check_caps(e, amount, state.provider_spent, p.provider_per_transfer_cap, p.provider_total_cap);
        state.provider_spent += amount;
    } else if p.recipients.contains(&to) {
        check_caps(e, amount, state.recipient_spent, p.recipient_per_transfer_cap, p.recipient_total_cap);
        state.recipient_spent += amount;
    } else {
        panic_with_error!(e, CovenantError::PayeeNotAllowed);
    }
}

fn enforce_listed_call(e: &Env, state: &CovenantState, contract: &Address, fn_name: &Symbol, args: &Vec<Val>) {
    check_expiry(e, state.params.expiry);
    let rule = state
        .params
        .calls
        .iter()
        .find(|r| r.contract == *contract && r.fn_name == *fn_name)
        .unwrap_or_else(|| panic_with_error!(e, CovenantError::CallNotAllowed));
    if let Some(i) = rule.amount_arg {
        let v: i128 = args
            .get(i)
            .and_then(|v| i128::try_from_val(e, &v).ok())
            .unwrap_or_else(|| panic_with_error!(e, CovenantError::CallCapExceeded));
        if v <= 0 || v > rule.amount_cap {
            panic_with_error!(e, CovenantError::CallCapExceeded);
        }
    }
}

fn check_expiry(e: &Env, expiry: u32) {
    if e.ledger().sequence() >= expiry {
        panic_with_error!(e, CovenantError::Expired);
    }
}

fn check_caps(e: &Env, amount: i128, spent: i128, per_transfer: i128, total: i128) {
    if amount > per_transfer {
        panic_with_error!(e, CovenantError::PerTransferCapExceeded);
    }
    if spent + amount > total {
        panic_with_error!(e, CovenantError::TotalCapExceeded);
    }
}
