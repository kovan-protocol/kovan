//! Types shared by the covenant policy and the pool. Pure library crate
//! (no cdylib) so it can be linked into other contracts under LTO.
#![no_std]
use soroban_sdk::{contracterror, contracttype, Address, Symbol, Vec};

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

