//! Pool storage: keys, records and errors.
use kovan_covenant_types::CovenantParams;
use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Active,
    SettleRequested,
    Revoked,
    Closed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Dispute {
    pub by: Address,
    pub evidence: BytesN<32>,
    pub outcome: Option<u32>,
}

/// Everything the pool knows about one agent.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentRecord {
    pub covenant: CovenantParams,
    pub draw_limit: i128,
    pub drawn: i128,
    /// Net pool funding consumed when this account was closed (not gross payments).
    pub settled_spent: i128,
    pub status: Status,
    pub parent: Option<Address>,
    pub children: Vec<Address>,
    /// Zero or one dispute (Option<struct> is not representable as ScVal).
    pub dispute: Vec<Dispute>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolInfo {
    pub accounting_version: u32,
    /// Permanent shutdown, not deletion of the contract or its history.
    pub closed: bool,
    pub owner: Address,
    pub usdc: Address,
    pub locked: i128,
    pub sum_limits: i128,
    pub settled_spent: i128,
    pub balance: i128,
    pub outstanding: i128,
    pub agent_count: u32,
}

#[contracttype]
pub enum PoolKey {
    Owner,
    Usdc,
    AccountWasm,
    Policy,
    Verifier,
    Outstanding,
    SumLimits,
    SettledSpent,
    Salt,
    Agent(Address),
    Agents,
    Closed,
    OpenAgents,
    YieldConfig,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum PoolError {
    NotOwner = 1,
    NotAgent = 2,
    NotOwnerOrParent = 3,
    ExceedsLocked = 4,
    ExceedsDrawLimit = 5,
    NotActive = 6,
    DrawnNotZero = 7,
    ExceedsRemaining = 8,
    BelowDrawn = 9,
    Insufficient = 10,
    NotActiveOrSettle = 11,
    ChildExceedsParent = 12,
    AmountNotPositive = 13,
    UnknownAgent = 14,
    TooManyChildren = 15,
    Expired = 16,
    PoolClosed = 17,
    PoolNotEmpty = 18,
    YieldNotConfigured = 19,
    YieldAlreadyConfigured = 20,
    YieldInvalidVault = 21,
    YieldCodeChanged = 22,
    YieldQuoteExpired = 23,
    YieldSlippage = 24,
    YieldLiquidity = 25,
    YieldUnderfunded = 26,
    YieldArithmetic = 27,
}

/// Children per parent, so `revoke` and `close` stay within one transaction's budget.
pub const MAX_CHILDREN: u32 = 16;

const DAY_IN_LEDGERS: u32 = 17280;
pub const EXTEND_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const TTL_THRESHOLD: u32 = EXTEND_AMOUNT - DAY_IN_LEDGERS;

// ---- instance values -------------------------------------------------------

pub fn get_address(e: &Env, key: PoolKey) -> Address {
    e.storage().instance().get(&key).expect("pool not initialized")
}

pub fn get_i128(e: &Env, key: PoolKey) -> i128 {
    e.storage().instance().get(&key).unwrap_or(0)
}

pub fn is_closed(e: &Env) -> bool {
    e.storage().instance().get(&PoolKey::Closed).unwrap_or(false)
}

pub fn set_i128(e: &Env, key: PoolKey, v: i128) {
    e.storage().instance().set(&key, &v);
}

pub fn next_salt(e: &Env) -> u32 {
    let n: u32 = e.storage().instance().get(&PoolKey::Salt).unwrap_or(0);
    e.storage().instance().set(&PoolKey::Salt, &(n + 1));
    n
}

// ---- agents -----------------------------------------------------------------

pub fn get_agent(e: &Env, agent: &Address) -> AgentRecord {
    let key = PoolKey::Agent(agent.clone());
    e.storage()
        .persistent()
        .get(&key)
        .inspect(|_| e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, EXTEND_AMOUNT))
        .unwrap_or_else(|| panic_with_error!(e, PoolError::UnknownAgent))
}

pub fn set_agent(e: &Env, agent: &Address, rec: &AgentRecord) {
    let key = PoolKey::Agent(agent.clone());
    e.storage().persistent().set(&key, rec);
    e.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, EXTEND_AMOUNT);
}

pub fn list_agents(e: &Env) -> Vec<Address> {
    e.storage().instance().get(&PoolKey::Agents).unwrap_or_else(|| Vec::new(e))
}

pub fn push_agent(e: &Env, agent: &Address) {
    let mut v = list_agents(e);
    v.push_back(agent.clone());
    e.storage().instance().set(&PoolKey::Agents, &v);
    set_i128(e, PoolKey::OpenAgents, get_i128(e, PoolKey::OpenAgents) + 1);
}
