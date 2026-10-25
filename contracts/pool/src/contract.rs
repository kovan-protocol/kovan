//! Pool entrypoints.
//!
//! The pool is the bank. It enforces one thing: how much each agent may draw.
//! What an agent does with drawn funds is the covenant's job (see the policy
//! crate). Invariant: sum of active draw limits <= locked.
use kovan_covenant_policy::{Amendment, CovenantParams, CovenantPolicyContractClient};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, token, xdr::ToXdr, Address, BytesN, ContractExecutable, Env,
    IntoVal, Val, Vec,
};

use crate::storage::{self as st, AgentRecord, Dispute, PoolError, PoolInfo, PoolKey, Status};

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

    /// Locks USDC in the pool.
    pub fn fund(e: &Env, amount: i128) {
        let owner = Self::owner(e);
        owner.require_auth();
        positive(e, amount);
        usdc(e).transfer(&owner, &e.current_contract_address(), &amount);
        st::set_i128(e, PoolKey::Locked, st::get_i128(e, PoolKey::Locked) + amount);
    }

    /// Takes back USDC that no covenant is backing.
    pub fn withdraw(e: &Env, amount: i128) {
        let owner = Self::owner(e);
        owner.require_auth();
        positive(e, amount);
        let locked = st::get_i128(e, PoolKey::Locked);
        let sum = st::get_i128(e, PoolKey::SumLimits);
        if amount > locked - sum {
            panic_with_error!(e, PoolError::Insufficient);
        }
        usdc(e).transfer(&e.current_contract_address(), &owner, &amount);
        st::set_i128(e, PoolKey::Locked, locked - amount);
    }

    /// Creates an agent: deploys its frozen smart account and records its covenant.
    pub fn create_agent(e: &Env, agent_pubkey: BytesN<32>, draw_limit: i128, covenant: CovenantParams) -> Address {
        Self::owner(e).require_auth();
        positive(e, draw_limit);
        let sum = st::get_i128(e, PoolKey::SumLimits);
        if sum + draw_limit > st::get_i128(e, PoolKey::Locked) {
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
                status: Status::Active,
                parent: None,
                children: Vec::new(e),
                dispute: Vec::new(e),
            },
        );
        st::push_agent(e, &agent);
        st::set_i128(e, PoolKey::SumLimits, sum + draw_limit);
        agent
    }

    // ---- agent ----------------------------------------------------------

    /// Moves `amount` from the pool into the agent's own account, within its draw limit.
    pub fn draw(e: &Env, agent: Address, amount: i128) {
        agent.require_auth();
        positive(e, amount);
        let mut rec = st::get_agent(e, &agent);
        if rec.status != Status::Active {
            panic_with_error!(e, PoolError::NotActive);
        }
        if rec.drawn + amount > rec.draw_limit {
            panic_with_error!(e, PoolError::ExceedsDrawLimit);
        }
        usdc(e).transfer(&e.current_contract_address(), &agent, &amount);
        rec.drawn += amount;
        st::set_agent(e, &agent, &rec);
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
        let me = e.current_contract_address();
        usdc(e).transfer_from(&me, &agent, &me, &amount);
        rec.drawn = (rec.drawn - amount).max(0);
        st::set_agent(e, &agent, &rec);
    }

    // ---- lifecycle ------------------------------------------------------

    /// Kill switch. Owner or the agent's parent. Freezes spend and calls on
    /// the covenant; `return_funds` keeps working. Recursive to children.
    pub fn revoke(e: &Env, agent: Address, by: Address) {
        let mut rec = st::get_agent(e, &agent);
        Self::require_owner_or_parent(e, &rec, &by);
        Self::revoke_inner(e, &agent, &mut rec);
    }

    /// Owner-only. Changes the draw limit and the covenant's numeric caps.
    pub fn amend(e: &Env, agent: Address, draw_limit: i128, amendment: Amendment) {
        Self::owner(e).require_auth();
        positive(e, draw_limit);
        let mut rec = st::get_agent(e, &agent);
        if draw_limit < rec.drawn {
            panic_with_error!(e, PoolError::BelowDrawn);
        }
        let sum = st::get_i128(e, PoolKey::SumLimits);
        let new_sum = sum - rec.draw_limit + draw_limit;
        if new_sum > st::get_i128(e, PoolKey::Locked) {
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
    }

    /// Agent asks to close.
    pub fn settle(e: &Env, agent: Address) {
        agent.require_auth();
        let mut rec = st::get_agent(e, &agent);
        if rec.status != Status::Active {
            panic_with_error!(e, PoolError::NotActive);
        }
        rec.status = Status::SettleRequested;
        st::set_agent(e, &agent, &rec);
    }

    /// Final. Owner or parent. Requires everything drawn to be back and all
    /// children closed. Frees the draw limit: back to the parent if there is
    /// one, otherwise out of the pool's sum of limits.
    pub fn close(e: &Env, agent: Address, by: Address) {
        let mut rec = st::get_agent(e, &agent);
        Self::require_owner_or_parent(e, &rec, &by);
        if rec.drawn != 0 {
            panic_with_error!(e, PoolError::DrawnNotZero);
        }
        for child in rec.children.iter() {
            if st::get_agent(e, &child).status != Status::Closed {
                panic_with_error!(e, PoolError::NotActiveOrSettle);
            }
        }
        match rec.parent.clone() {
            Some(parent) => {
                let mut p = st::get_agent(e, &parent);
                p.draw_limit += rec.draw_limit;
                st::set_agent(e, &parent, &p);
            }
            None => {
                let sum = st::get_i128(e, PoolKey::SumLimits);
                st::set_i128(e, PoolKey::SumLimits, sum - rec.draw_limit);
            }
        }
        rec.status = Status::Closed;
        st::set_agent(e, &agent, &rec);
    }

    /// Records an objection. Owner or agent. Nothing moves.
    pub fn dispute(e: &Env, agent: Address, by: Address, evidence: BytesN<32>) {
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
        let mut rec = st::get_agent(e, &agent);
        let Some(mut d) = rec.dispute.get(0) else { panic_with_error!(e, PoolError::NotActiveOrSettle) };
        d.outcome = Some(outcome);
        rec.dispute.set(0, d);
        st::set_agent(e, &agent, &rec);
    }

    // ---- reads ----------------------------------------------------------

    pub fn get_agent(e: &Env, agent: Address) -> AgentRecord {
        st::get_agent(e, &agent)
    }

    pub fn get_pool(e: &Env) -> PoolInfo {
        PoolInfo {
            owner: Self::owner(e),
            usdc: st::get_address(e, PoolKey::Usdc),
            locked: st::get_i128(e, PoolKey::Locked),
            sum_limits: st::get_i128(e, PoolKey::SumLimits),
            agent_count: st::list_agents(e).len(),
        }
    }

    pub fn list_agents(e: &Env) -> Vec<Address> {
        st::list_agents(e)
    }
}

impl KovanPool {
    fn require_owner_or_parent(e: &Env, rec: &AgentRecord, by: &Address) {
        let ok = *by == Self::owner(e) || rec.parent.as_ref() == Some(by);
        if !ok {
            panic_with_error!(e, PoolError::NotOwnerOrParent);
        }
        by.require_auth();
    }

    fn revoke_inner(e: &Env, agent: &Address, rec: &mut AgentRecord) {
        if rec.status == Status::Closed {
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

fn policy(e: &Env) -> CovenantPolicyContractClient<'_> {
    CovenantPolicyContractClient::new(e, &st::get_address(e, PoolKey::Policy))
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
