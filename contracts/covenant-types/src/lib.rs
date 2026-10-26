//! Types shared by the covenant policy and the pool. Pure library crate
//! (no cdylib) so it can be linked into other contracts under LTO.
#![no_std]
use soroban_sdk::{contracterror, contracttype, crypto::Hash, xdr::ToXdr, Address, BytesN, Env, Symbol, Vec};

/// Kovan's native mandate profile, not an AP2 credential format.
pub const MANDATE_VERSION: u32 = 1;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentTerms {
    pub asset: Address,
    pub payee: Address,
    pub amount: i128,
    pub reference: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MandateBudget {
    pub payees: Vec<Address>,
    pub per_payment_cap: i128,
    pub total_cap: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MandateScope {
    Budget(MandateBudget),
    Exact(PaymentTerms),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MandateParams {
    pub id: BytesN<32>,
    /// Commitment to the owner's intent document. Never interpreted as instructions.
    pub intent_hash: BytesN<32>,
    /// Exclusive ledger deadline, independent of storage TTL.
    pub expiry: u32,
    pub scope: MandateScope,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MandateState {
    pub params: MandateParams,
    pub spent: i128,
    pub payments: u32,
    pub revoked: bool,
}

/// Covered by the agent signature in addition to the host's invocation digest.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentBinding {
    pub mandate_id: BytesN<32>,
    /// Unique per agent, across ALL its mandates and authorization nonces.
    pub payment_id: BytesN<32>,
    pub reference: BytesN<32>,
    pub valid_until: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentReceipt {
    pub payment_id: BytesN<32>,
    pub mandate_id: BytesN<32>,
    pub terms: PaymentTerms,
    pub authorization_hash: BytesN<32>,
    pub ledger: u32,
}

/// Domain-separated commitment; the host hash retains network, nonce, expiry and invocation.
pub fn payment_payload(e: &Env, host_payload: &BytesN<32>, payment: &PaymentBinding) -> Hash<32> {
    e.crypto().sha256(&(Symbol::new(e, "kovan_mandate_payment_v1"), host_payload.clone(), payment.clone()).to_xdr(e))
}

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
    MandateRequired = 3915,
    MandateInvalid = 3916,
    MandateExists = 3917,
    MandateMissing = 3918,
    MandateRevoked = 3919,
    MandateExceeded = 3920,
    PaymentConsumed = 3921,
    PaymentMismatch = 3922,
}
