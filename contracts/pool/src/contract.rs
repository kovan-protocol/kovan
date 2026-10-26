//! Pool entrypoints.
//!
//! The pool is the bank. It enforces one thing: how much each agent may draw.
//! What an agent does with drawn funds is the covenant's job (see the policy
//! crate). In v3, `locked` is cash + outstanding advances + discounted vault
//! value. Investment losses can breach backing: new allocation/increased limits,
//! cash extraction and draws are then blocked; revocation/recovery still work.
//! Cash-only is the default. The owner must explicitly opt in before opening agents.
use kovan_covenant_types::{Amendment, CovenantParams, MandateParams, MandateState, PaymentReceipt, MANDATE_VERSION};
use soroban_sdk::{
    contract, contractclient, contractimpl, panic_with_error, token, xdr::ToXdr, Address, BytesN, ContractExecutable, Env,
    IntoVal, Val, Vec,
};

use crate::events::{AgentCreated, Amended, Closed, Delegated, Drawn, Funded, PoolClosed, Returned, Revoked, SettlementRequested, Withdrawn};
use crate::storage::{self as st, AgentRecord, Dispute, PoolError, PoolInfo, PoolKey, Status, MAX_CHILDREN};
use crate::yield_source::{self as yield_source, YieldInfo};

/// Pool-authorized policy administration and public mandate reads.
#[contractclient(name = "CovenantPolicyClient")]
pub trait CovenantPolicyAdmin {
    fn set_revoked(e: &Env, smart_account: Address, revoked: bool);
    fn amend(e: &Env, smart_account: Address, amendment: Amendment);
    fn create_mandate(e: &Env, smart_account: Address, params: MandateParams);
    fn revoke_mandate(e: &Env, smart_account: Address, id: BytesN<32>);
    fn get_mandate(e: &Env, smart_account: Address, id: BytesN<32>) -> Vec<MandateState>;
    fn get_payment(e: &Env, smart_account: Address, id: BytesN<32>) -> Vec<PaymentReceipt>;
}

#[contract]
pub struct KovanPool;

#[contractimpl]
impl KovanPool {
    pub fn __constructor(e: &Env, owner: Address, usdc: Address, account_wasm_hash: BytesN<32>, policy: Address, verifier: Address) {
        e.storage().instance().set(&PoolKey::Owner, &owner);
        e.storage().instance().set(&PoolKey::Usdc, &usdc);
        e.storage().instance().set(&PoolKey::AccountWasm, &account_wasm_hash);
        e.storage().instance().set(&PoolKey::Policy, &policy);
        e.storage().instance().set(&PoolKey::Verifier, &verifier);
    }

    // ---- owner ----------------------------------------------------------

    pub fn mandate_version(_e: &Env) -> u32 { MANDATE_VERSION }

    /// Immutable deployment bindings, so clients never mix policy generations.
    pub fn get_config(e: &Env) -> st::PoolConfig {
        st::PoolConfig {
            owner: Self::owner(e), usdc: e.storage().instance().get(&PoolKey::Usdc).unwrap(),
            policy: e.storage().instance().get(&PoolKey::Policy).unwrap(),
            verifier: e.storage().instance().get(&PoolKey::Verifier).unwrap(),
            account_wasm_hash: e.storage().instance().get(&PoolKey::AccountWasm).unwrap(),
            mandate_version: MANDATE_VERSION,
        }
    }

    /// Only the original owner can grant new spending authority, including for children.
    pub fn create_mandate(e: &Env, agent: Address, params: MandateParams) {
        Self::owner(e).require_auth();
        Self::require_open(e);
        let rec = st::get_agent(e, &agent);
        if rec.status != Status::Active { panic_with_error!(e, PoolError::NotActive); }
        let version: u32 = e.invoke_contract(&agent, &soroban_sdk::Symbol::new(e, "mandate_version"), Vec::new(e));
        if version != MANDATE_VERSION { panic_with_error!(e, PoolError::UnsupportedMandate); }
        policy(e).create_mandate(&agent, &params);
    }

    pub fn revoke_mandate(e: &Env, agent: Address, id: BytesN<32>) {
        Self::owner(e).require_auth();
        st::get_agent(e, &agent);
        policy(e).revoke_mandate(&agent, &id);
    }

    pub fn get_mandate(e: &Env, agent: Address, id: BytesN<32>) -> Vec<MandateState> {
        st::get_agent(e, &agent);
        policy(e).get_mandate(&agent, &id)
    }

    pub fn get_payment(e: &Env, agent: Address, id: BytesN<32>) -> Vec<PaymentReceipt> {
        st::get_agent(e, &agent);
        policy(e).get_payment(&agent, &id)
    }

    /// One explicit opt-in before opening agents; no vault replacement or upgrades.
    pub fn configure_yield(e: &Env, vault: Address, wasm_hash: BytesN<32>) {
        Self::owner(e).require_auth();
        Self::require_open(e);
        yield_source::configure(e, vault, wasm_hash);
    }

    pub fn invest(e: &Env, amount: i128, min_shares: i128, valid_until: u32) {
        Self::owner(e).require_auth();
        Self::require_open(e);
        yield_source::invest(e, amount, min_shares, valid_until);
    }

    pub fn lock_shares(e: &Env, shares: i128, min_assets: i128, valid_until: u32) {
        Self::owner(e).require_auth();
        Self::require_open(e);
        yield_source::lock(e, shares, min_assets, valid_until);
    }

    pub fn redeem_shares(e: &Env, shares: i128, min_assets: i128, valid_until: u32) {
        Self::owner(e).require_auth();
        yield_source::redeem(e, shares, min_assets, valid_until);
    }

    pub fn release_shares(e: &Env, shares: i128) {
        Self::owner(e).require_auth();
        yield_source::release(e, shares);
    }

    pub fn get_yield(e: &Env) -> YieldInfo { yield_source::info(e) }

    /// Locks USDC in the pool.
    pub fn fund(e: &Env, amount: i128) {
        let owner = Self::owner(e);
        owner.require_auth();
        Self::require_open(e);
        positive(e, amount);
        usdc(e).transfer(&owner, &e.current_contract_address(), &amount);
        let locked = Self::accounted_funds(e);
        Funded { amount, locked }.publish(e);
    }

    /// Takes back USDC that no covenant is backing. Remains available after
    /// shutdown so unsolicited deposits can never re-open the pool or be trapped.
    pub fn withdraw(e: &Env, amount: i128) {
        let owner = Self::owner(e);
        owner.require_auth();
        positive(e, amount);
        let locked = Self::accounted_funds(e);
        let sum = st::get_i128(e, PoolKey::SumLimits);
        if amount > locked - sum {
            panic_with_error!(e, PoolError::Insufficient);
        }
        usdc(e).transfer(&e.current_contract_address(), &owner, &amount);
        Withdrawn { amount, locked: locked - amount }.publish(e);
    }

    /// Permanently shuts down an empty-of-agents pool and returns all pool cash
    /// to its original owner, atomically. Agent recovery is done child-first in
    /// separate transactions; an open-agent counter keeps this final step bounded.
    /// No re-open or upgrade entrypoint exists. Read history and late-fund recovery
    /// remain available; deleting state would lose both ownership and finality.
    pub fn close_pool(e: &Env) {
        let owner = Self::owner(e);
        owner.require_auth();
        Self::require_open(e);
        if st::get_i128(e, PoolKey::OpenAgents) != 0
            || st::get_i128(e, PoolKey::SumLimits) != 0
            || st::get_i128(e, PoolKey::Outstanding) != 0
        {
            panic_with_error!(e, PoolError::PoolNotEmpty);
        }
        e.storage().instance().set(&PoolKey::Closed, &true);
        yield_source::release_all(e);
        let returned = usdc(e).balance(&e.current_contract_address());
        if returned > 0 {
            usdc(e).transfer(&e.current_contract_address(), &owner, &returned);
        }
        PoolClosed { owner, returned }.publish(e);
    }

    /// Creates an agent: deploys its frozen smart account and records its covenant.
    pub fn create_agent(e: &Env, agent_pubkey: BytesN<32>, draw_limit: i128, covenant: CovenantParams) -> Address {
        Self::owner(e).require_auth();
        Self::require_open(e);
        positive(e, draw_limit);
        require_future_expiry(e, covenant.expiry);
        let sum = st::get_i128(e, PoolKey::SumLimits);
        if sum + draw_limit > Self::accounted_funds(e) {
            panic_with_error!(e, PoolError::ExceedsLocked);
        }
        let agent = Self::deploy_account(e, agent_pubkey, &covenant);
        st::set_agent(
            e,
            &agent,
            &AgentRecord {
                covenant: pinned(e, covenant),
                draw_limit,
                drawn: 0,
                settled_spent: 0,
                status: Status::Active,
                parent: None,
                children: Vec::new(e),
                dispute: Vec::new(e),
            },
        );
        st::push_agent(e, &agent);
        st::set_i128(e, PoolKey::SumLimits, sum + draw_limit);
        AgentCreated { agent: agent.clone(), draw_limit }.publish(e);
        agent
    }

    // ---- agent ----------------------------------------------------------

    /// Moves `amount` from the pool into the agent's own account, within its draw limit.
    pub fn draw(e: &Env, agent: Address, amount: i128) {
        Self::require_open(e);
        agent.require_auth();
        positive(e, amount);
        let mut rec = st::get_agent(e, &agent);
        if rec.status != Status::Active {
            panic_with_error!(e, PoolError::NotActive);
        }
        require_future_expiry(e, rec.covenant.expiry);
        if rec.drawn + amount > rec.draw_limit {
            panic_with_error!(e, PoolError::ExceedsDrawLimit);
        }
        if yield_source::config(e).is_some() {
            yield_source::require_backed(e);
            yield_source::ensure_cash(e, amount);
        }
        usdc(e).transfer(&e.current_contract_address(), &agent, &amount);
        rec.drawn += amount;
        st::set_i128(e, PoolKey::Outstanding, st::get_i128(e, PoolKey::Outstanding) + amount);
        st::set_agent(e, &agent, &rec);
        if yield_source::config(e).is_some() { yield_source::require_backed(e); }
        Drawn { agent, amount, drawn: rec.drawn }.publish(e);
    }

    /// Moves USDC from the agent's account back to the pool. The agent or the
    /// owner may call it; the owner's path uses the allowance the account
    /// granted at creation, so no agent signature is needed.
    pub fn return_funds(e: &Env, agent: Address, by: Address, amount: i128) {
        if by != agent && by != Self::owner(e) {
            panic_with_error!(e, PoolError::NotOwnerOrParent);
        }
        by.require_auth();
        positive(e, amount);
        let mut rec = st::get_agent(e, &agent);
        Self::recover(e, &agent, &mut rec, amount);
        st::set_agent(e, &agent, &rec);
        Returned { agent, by, amount, drawn: rec.drawn }.publish(e);
    }

    // ---- lifecycle ------------------------------------------------------

    /// Kill switch. Owner or the agent's parent. Freezes spend and calls on
    /// the covenant; `return_funds` keeps working. Recursive to children.
    pub fn revoke(e: &Env, agent: Address, by: Address) {
        Self::require_open(e);
        let mut rec = st::get_agent(e, &agent);
        Self::require_owner_or_parent(e, &rec, &by);
        Self::revoke_inner(e, &agent, &mut rec);
        Revoked { agent, by }.publish(e);
    }

    /// Owner-only. Changes the draw limit and the covenant's numeric caps.
    pub fn amend(e: &Env, agent: Address, draw_limit: i128, amendment: Amendment) {
        Self::owner(e).require_auth();
        Self::require_open(e);
        positive(e, draw_limit);
        require_future_expiry(e, amendment.expiry);
        let mut rec = st::get_agent(e, &agent);
        if rec.status == Status::Closed {
            panic_with_error!(e, PoolError::NotActive);
        }
        if draw_limit < rec.drawn {
            panic_with_error!(e, PoolError::BelowDrawn);
        }
        let sum = st::get_i128(e, PoolKey::SumLimits);
        let new_sum = sum - rec.draw_limit + draw_limit;
        if new_sum > sum && new_sum > Self::accounted_funds(e) {
            panic_with_error!(e, PoolError::ExceedsLocked);
        }
        rec.draw_limit = draw_limit;
        rec.covenant.provider_per_transfer_cap = amendment.provider_per_transfer_cap;
        rec.covenant.provider_total_cap = amendment.provider_total_cap;
        rec.covenant.recipient_per_transfer_cap = amendment.recipient_per_transfer_cap;
        rec.covenant.recipient_total_cap = amendment.recipient_total_cap;
        rec.covenant.expiry = amendment.expiry;
        st::set_agent(e, &agent, &rec);
        st::set_i128(e, PoolKey::SumLimits, new_sum);
        policy(e).amend(&agent, &amendment);
        Amended { agent, draw_limit }.publish(e);
    }

    /// Agent asks to close.
    pub fn settle(e: &Env, agent: Address) {
        Self::require_open(e);
        agent.require_auth();
        let mut rec = st::get_agent(e, &agent);
        if rec.status != Status::Active {
            panic_with_error!(e, PoolError::NotActive);
        }
        rec.status = Status::SettleRequested;
        st::set_agent(e, &agent, &rec);
        // A settlement request freezes outgoing payments as well as new draws.
        policy(e).set_revoked(&agent, &true);
        SettlementRequested { agent }.publish(e);
    }

    /// Final. Owner or parent. All children must be closed first. Atomically
    /// freezes spending, recovers the wallet balance, and realizes any funding
    /// consumed. Only the unused allocation becomes available again.
    pub fn close(e: &Env, agent: Address, by: Address) {
        Self::require_open(e);
        let mut rec = st::get_agent(e, &agent);
        Self::require_owner_or_parent(e, &rec, &by);
        if rec.status == Status::Closed {
            panic_with_error!(e, PoolError::NotActive);
        }
        for child in rec.children.iter() {
            if st::get_agent(e, &child).status != Status::Closed {
                panic_with_error!(e, PoolError::NotActiveOrSettle);
            }
        }
        policy(e).set_revoked(&agent, &true);
        let recovered = usdc(e).balance(&agent);
        if recovered > 0 {
            Self::recover(e, &agent, &mut rec, recovered);
            Returned { agent: agent.clone(), by: by.clone(), amount: recovered, drawn: rec.drawn }.publish(e);
        }
        let consumed = rec.drawn;
        let released = rec.draw_limit - consumed;
        st::set_i128(e, PoolKey::Outstanding, st::get_i128(e, PoolKey::Outstanding) - consumed);
        st::set_i128(e, PoolKey::SettledSpent, st::get_i128(e, PoolKey::SettledSpent) + consumed);
        let sum = st::get_i128(e, PoolKey::SumLimits);
        match rec.parent.clone() {
            Some(parent) => {
                let mut p = st::get_agent(e, &parent);
                p.draw_limit += released;
                st::set_agent(e, &parent, &p);
                // Child consumption reduces the family's remaining allocation.
                st::set_i128(e, PoolKey::SumLimits, sum - consumed);
            }
            None => {
                st::set_i128(e, PoolKey::SumLimits, sum - rec.draw_limit);
            }
        }
        rec.drawn = 0;
        rec.settled_spent = consumed;
        rec.status = Status::Closed;
        st::set_agent(e, &agent, &rec);
        st::set_i128(e, PoolKey::OpenAgents, st::get_i128(e, PoolKey::OpenAgents) - 1);
        Closed { agent, recovered, consumed, released }.publish(e);
    }

    /// Records an objection. Owner or agent. Nothing moves.
    pub fn dispute(e: &Env, agent: Address, by: Address, evidence: BytesN<32>) {
        Self::require_open(e);
        if by != agent && by != Self::owner(e) {
            panic_with_error!(e, PoolError::NotOwnerOrParent);
        }
        by.require_auth();
        let mut rec = st::get_agent(e, &agent);
        let mut v = Vec::new(e);
        v.push_back(Dispute { by, evidence, outcome: None });
        rec.dispute = v;
        st::set_agent(e, &agent, &rec);
    }

    /// Owner rules on the recorded dispute.
    pub fn resolve_dispute(e: &Env, agent: Address, outcome: u32) {
        Self::owner(e).require_auth();
        Self::require_open(e);
        let mut rec = st::get_agent(e, &agent);
        let Some(mut d) = rec.dispute.get(0) else { panic_with_error!(e, PoolError::NotActiveOrSettle) };
        d.outcome = Some(outcome);
        rec.dispute.set(0, d);
        st::set_agent(e, &agent, &rec);
    }

    // ---- delegation -----------------------------------------------------

    /// A parent agent carves a narrower covenant for a child out of its own
    /// remaining allowance. The child's limits must fit inside the parent's
    /// on every dimension. The pool's sum of limits does not change.
    pub fn delegate(e: &Env, parent: Address, child_pubkey: BytesN<32>, child_draw_limit: i128, child_covenant: CovenantParams) -> Address {
        parent.require_auth();
        Self::require_open(e);
        positive(e, child_draw_limit);
        let mut prec = st::get_agent(e, &parent);
        if prec.status != Status::Active {
            panic_with_error!(e, PoolError::NotActive);
        }
        require_future_expiry(e, prec.covenant.expiry);
        require_future_expiry(e, child_covenant.expiry);
        if child_draw_limit > prec.draw_limit - prec.drawn {
            panic_with_error!(e, PoolError::ChildExceedsParent);
        }
        if prec.children.len() >= MAX_CHILDREN {
            panic_with_error!(e, PoolError::TooManyChildren);
        }
        Self::require_subset(e, &prec.covenant, &child_covenant);

        let child = Self::deploy_account(e, child_pubkey, &child_covenant);
        prec.draw_limit -= child_draw_limit;
        prec.children.push_back(child.clone());
        st::set_agent(e, &parent, &prec);
        st::set_agent(
            e,
            &child,
            &AgentRecord {
                covenant: pinned(e, child_covenant),
                draw_limit: child_draw_limit,
                drawn: 0,
                settled_spent: 0,
                status: Status::Active,
                parent: Some(parent.clone()),
                children: Vec::new(e),
                dispute: Vec::new(e),
            },
        );
        st::push_agent(e, &child);
        Delegated { parent, child: child.clone(), draw_limit: child_draw_limit }.publish(e);
        child
    }

    // ---- reads ----------------------------------------------------------

    pub fn get_agent(e: &Env, agent: Address) -> AgentRecord {
        st::get_agent(e, &agent)
    }

    pub fn get_pool(e: &Env) -> PoolInfo {
        let balance = usdc(e).balance(&e.current_contract_address());
        PoolInfo {
            accounting_version: 3,
            closed: st::is_closed(e),
            owner: Self::owner(e),
            usdc: st::get_address(e, PoolKey::Usdc),
            locked: Self::accounted_funds(e),
            sum_limits: st::get_i128(e, PoolKey::SumLimits),
            settled_spent: st::get_i128(e, PoolKey::SettledSpent),
            balance,
            outstanding: st::get_i128(e, PoolKey::Outstanding),
            agent_count: st::list_agents(e).len(),
        }
    }

    pub fn list_agents(e: &Env) -> Vec<Address> {
        st::list_agents(e)
    }
}

impl KovanPool {
    fn require_open(e: &Env) {
        if st::is_closed(e) {
            panic_with_error!(e, PoolError::PoolClosed);
        }
    }

    fn accounted_funds(e: &Env) -> i128 {
        yield_source::accounted(e)
    }

    /// Repaid principal reduces outstanding funding. Earnings or deposits above
    /// that amount increase the pool's accounted funds, rather than getting stuck.
    fn recover(e: &Env, agent: &Address, rec: &mut AgentRecord, amount: i128) {
        let me = e.current_contract_address();
        usdc(e).transfer_from(&me, agent, &me, &amount);
        let principal = amount.min(rec.drawn);
        rec.drawn -= principal;
        st::set_i128(e, PoolKey::Outstanding, st::get_i128(e, PoolKey::Outstanding) - principal);
    }

    /// Child covenant ⊆ parent covenant, or `ChildExceedsParent`.
    fn require_subset(e: &Env, p: &CovenantParams, c: &CovenantParams) {
        let fail = || panic_with_error!(e, PoolError::ChildExceedsParent);
        for a in c.providers.iter() {
            if !p.providers.contains(&a) { fail(); }
        }
        for a in c.recipients.iter() {
            if !p.recipients.contains(&a) { fail(); }
        }
        for r in c.calls.iter() {
            // Same contract and function; if the parent caps an argument, the
            // child must cap the same argument at most as high.
            let ok = p.calls.iter().any(|pr| {
                pr.contract == r.contract
                    && pr.fn_name == r.fn_name
                    && (pr.amount_arg.is_none() || (r.amount_arg == pr.amount_arg && r.amount_cap <= pr.amount_cap))
            });
            if !ok { fail(); }
        }
        if c.provider_per_transfer_cap > p.provider_per_transfer_cap
            || c.provider_total_cap > p.provider_total_cap
            || c.recipient_per_transfer_cap > p.recipient_per_transfer_cap
            || c.recipient_total_cap > p.recipient_total_cap
            || c.expiry > p.expiry
        {
            fail();
        }
    }

    fn require_owner_or_parent(e: &Env, rec: &AgentRecord, by: &Address) {
        let ok = *by == Self::owner(e) || rec.parent.as_ref() == Some(by);
        if !ok {
            panic_with_error!(e, PoolError::NotOwnerOrParent);
        }
        by.require_auth();
    }

    fn revoke_inner(e: &Env, agent: &Address, rec: &mut AgentRecord) {
        if rec.status == Status::Closed || rec.status == Status::Revoked {
            return;
        }
        rec.status = Status::Revoked;
        st::set_agent(e, agent, rec);
        policy(e).set_revoked(agent, &true);
        for child in rec.children.iter() {
            let mut c = st::get_agent(e, &child);
            Self::revoke_inner(e, &child, &mut c);
        }
    }

    fn owner(e: &Env) -> Address {
        st::get_address(e, PoolKey::Owner)
    }

    /// Deploys a frozen agent account bound to `covenant`.
    fn deploy_account(e: &Env, agent_pubkey: BytesN<32>, covenant: &CovenantParams) -> Address {
        let wasm_hash: BytesN<32> = e.storage().instance().get(&PoolKey::AccountWasm).expect("wasm hash");
        let policy = st::get_address(e, PoolKey::Policy);
        let verifier = st::get_address(e, PoolKey::Verifier);
        let covenant_val: Val = pinned(e, covenant.clone()).into_val(e);
        let salt = e.crypto().sha256(&st::next_salt(e).to_xdr(e)).to_bytes();
        e.deployer().with_current_contract(salt).deploy_contract(
            ContractExecutable::Wasm(wasm_hash),
            (agent_pubkey, verifier, policy, covenant_val, e.current_contract_address(), st::get_address(e, PoolKey::Usdc)),
        )
    }
}

fn policy(e: &Env) -> CovenantPolicyClient<'_> {
    CovenantPolicyClient::new(e, &st::get_address(e, PoolKey::Policy))
}

fn usdc(e: &Env) -> token::TokenClient<'_> {
    token::TokenClient::new(e, &st::get_address(e, PoolKey::Usdc))
}

/// The pool, not the caller, decides which pool and which asset a covenant refers to.
fn pinned(e: &Env, mut c: CovenantParams) -> CovenantParams {
    c.pool = e.current_contract_address();
    c.usdc = st::get_address(e, PoolKey::Usdc);
    c
}

fn positive(e: &Env, amount: i128) {
    if amount <= 0 {
        panic_with_error!(e, PoolError::AmountNotPositive);
    }
}

fn require_future_expiry(e: &Env, expiry: u32) {
    if e.ledger().sequence() >= expiry {
        panic_with_error!(e, PoolError::Expired);
    }
}
