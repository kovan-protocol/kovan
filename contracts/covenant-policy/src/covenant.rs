//! Covenant types, storage and (later) enforcement.
//!
//! A covenant is attached to one agent smart account. It says what the
//! account may do: pay allowlisted providers and recipients within caps,
//! call allowlisted contracts, and talk to the pool. State is keyed by the
//! smart account address: one covenant per account.
use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, Env, Symbol, Vec};

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
