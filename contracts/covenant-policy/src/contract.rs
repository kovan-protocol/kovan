//! Contract wrapper: exposes the covenant as an OpenZeppelin smart-account
//! policy plus the pool-only admin functions.
use soroban_sdk::{auth::Context, contract, contractimpl, Address, Env, Vec};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, Signer},
};

use crate::covenant::{self, Amendment, CovenantParams, CovenantState};

#[contract]
pub struct CovenantPolicyContract;

#[contractimpl]
impl Policy for CovenantPolicyContract {
    type AccountParams = CovenantParams;

    fn enforce(e: &Env, context: Context, authenticated_signers: Vec<Signer>, context_rule: ContextRule, smart_account: Address) {
        covenant::enforce(e, &context, &authenticated_signers, &context_rule, &smart_account)
    }

    fn install(e: &Env, install_params: CovenantParams, context_rule: ContextRule, smart_account: Address) {
        covenant::install(e, &install_params, &context_rule, &smart_account)
    }

    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        covenant::uninstall(e, &context_rule, &smart_account)
    }
}

#[contractimpl]
impl CovenantPolicyContract {
    /// Reads the covenant of a smart account.
    pub fn get_covenant(e: Env, smart_account: Address) -> CovenantState {
        covenant::get_state(&e, &smart_account)
    }

    /// Pool-only. Freezes (or unfreezes) spend and calls.
    pub fn set_revoked(e: Env, smart_account: Address, revoked: bool) {
        covenant::set_revoked(&e, &smart_account, revoked)
    }

    /// Pool-only. Changes numeric limits.
    pub fn amend(e: Env, smart_account: Address, amendment: Amendment) {
        covenant::amend(&e, &smart_account, &amendment)
    }
}
