//! Kovan covenant policy: the rules attached to an agent's smart account.
#![no_std]

pub mod contract;
pub mod covenant;

pub use contract::{CovenantPolicyContract, CovenantPolicyContractClient};
pub use covenant::{Amendment, CallRule, CovenantError, CovenantParams, CovenantState};

#[cfg(test)]
mod test;
