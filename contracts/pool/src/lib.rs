//! Kovan pool: the owner's locked USDC, the agents drawn from it, and their
//! covenants' lifecycle.
#![no_std]

pub mod contract;
pub mod events;
pub mod storage;
pub mod yield_source;

#[cfg(test)]
mod test;
