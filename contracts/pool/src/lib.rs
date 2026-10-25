//! Kovan pool: the owner's locked USDC, the agents drawn from it, and their
//! covenants' lifecycle.
#![no_std]

pub mod contract;
pub mod events;
pub mod storage;

#[cfg(test)]
mod test;
