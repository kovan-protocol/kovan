//! Pool events. One per state change, so a log needs no storage of its own.
use soroban_sdk::{contractevent, Address};

#[contractevent]
#[derive(Clone, Debug)]
pub struct Funded {
    pub amount: i128,
    pub locked: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct AgentCreated {
    #[topic]
    pub agent: Address,
    pub draw_limit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Drawn {
    #[topic]
    pub agent: Address,
    pub amount: i128,
    pub drawn: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Returned {
    #[topic]
    pub agent: Address,
    pub by: Address,
    pub amount: i128,
    pub drawn: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Revoked {
    #[topic]
    pub agent: Address,
    pub by: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Amended {
    #[topic]
    pub agent: Address,
    pub draw_limit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Closed {
    #[topic]
    pub agent: Address,
    pub recovered: i128,
    pub consumed: i128,
    pub released: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct SettlementRequested {
    #[topic]
    pub agent: Address,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Delegated {
    #[topic]
    pub parent: Address,
    pub child: Address,
    pub draw_limit: i128,
}

#[contractevent]
#[derive(Clone, Debug)]
pub struct Withdrawn {
    pub amount: i128,
    pub locked: i128,
}
