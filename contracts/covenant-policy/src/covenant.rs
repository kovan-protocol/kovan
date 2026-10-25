//! Covenant types, storage and (later) enforcement.
//!
//! A covenant is attached to one agent smart account. It says what the
//! account may do: pay allowlisted providers and recipients within caps,
//! call allowlisted contracts, and talk to the pool. State is keyed by the
//! smart account address: one covenant per account.
use soroban_sdk::{
    auth::{Context, ContractContext},
    contracterror, contracttype, panic_with_error, symbol_short, Address, Env, Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::smart_account::{ContextRule, Signer};

/// One allowlisted contract call. If `amount_arg` is set, that argument is
/// read as `i128` and must satisfy `0 < v <= amount_cap`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CallRule {
    pub contract: Address,
    pub fn_name: Symbol,
    pub amount_arg: Option<u32>,
    pub amount_cap: i128,
}

/// Installation parameters: the covenant as the owner wrote it.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CovenantParams {
    pub pool: Address,
    pub usdc: Address,
    pub providers: Vec<Address>,
    pub provider_per_transfer_cap: i128,
    pub provider_total_cap: i128,
    pub recipients: Vec<Address>,
    pub recipient_per_transfer_cap: i128,
    pub recipient_total_cap: i128,
    pub calls: Vec<CallRule>,
    /// Ledger sequence. Spend and calls are refused once `current >= expiry`.
    pub expiry: u32,
}

/// Stored covenant state for one smart account.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CovenantState {
    pub params: CovenantParams,
    pub rule_id: u32,
    pub provider_spent: i128,
    pub recipient_spent: i128,
    pub revoked: bool,
}

/// Numeric fields the pool may amend after installation.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Amendment {
    pub provider_per_transfer_cap: i128,
    pub provider_total_cap: i128,
    pub recipient_per_transfer_cap: i128,
    pub recipient_total_cap: i128,
    pub expiry: u32,
}

/// Error codes in the `39XX` range OpenZeppelin reserves for third-party
/// smart-account policies.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum CovenantError {
    NotInstalled = 3900,
    AlreadyInstalled = 3901,
    NotAllowed = 3902,
    WrongAsset = 3903,
    PayeeNotAllowed = 3904,
    AmountNotPositive = 3905,
    PerTransferCapExceeded = 3906,
    TotalCapExceeded = 3907,
    Expired = 3908,
    Revoked = 3909,
    CallNotAllowed = 3910,
    CallCapExceeded = 3911,
    SelfCallForbidden = 3912,
    NoSigner = 3913,
    NotPool = 3914,
}

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
    if state.revoked {
        panic_with_error!(e, CovenantError::Revoked);
    }
    let Context::Contract(ContractContext { contract, fn_name, args }) = context else {
        panic_with_error!(e, CovenantError::NotAllowed)
    };

    if contract == smart_account {
        panic_with_error!(e, CovenantError::SelfCallForbidden);
    }
    if *contract == state.params.pool {
        enforce_pool_call(e, fn_name);
        return;
    }
    if *contract == state.params.usdc {
        enforce_transfer(e, &mut state, fn_name, args);
        set_state(e, smart_account, &state);
        return;
    }
    enforce_listed_call(e, &state, contract, fn_name, args);
}

const POOL_FNS: [&str; 5] = ["draw", "return_funds", "settle", "dispute", "delegate"];

fn enforce_pool_call(e: &Env, fn_name: &Symbol) {
    for name in POOL_FNS.iter() {
        if *fn_name == Symbol::new(e, name) {
            return;
        }
    }
    panic_with_error!(e, CovenantError::CallNotAllowed)
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
    // Returning funds to the pool is always allowed, even after expiry.
    if to == state.params.pool {
        return;
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
