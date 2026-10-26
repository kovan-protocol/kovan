//! Opt-in local integration test using the published DeFindex testnet bytecode.
//! See docs/YIELD.md for fetching the pinned artifact. No chain writes occur here.
use super::*;
use crate::yield_source::{AssetStrategySet, VaultClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, map, Bytes, Executable, String, Symbol, Val,
};

#[test]
#[ignore = "requires KOVAN_DEFINDEX_WASM; download instructions in docs/YIELD.md"]
fn published_defindex_wasm_both_funding_paths_draw_and_recover() {
    let path = std::env::var("KOVAN_DEFINDEX_WASM")
        .expect("set KOVAN_DEFINDEX_WASM to the pinned vault WASM");
    let wasm = std::fs::read(path).unwrap();
    let pool_wasm = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../target/wasm32v1-none/release/kovan_pool.wasm"),
    )
    .expect("run make build first");
    let fx = setup_with_pool_wasm(Some(&pool_wasm));
    let hash =
        fx.e.crypto()
            .sha256(&Bytes::from_slice(&fx.e, &wasm))
            .to_bytes();
    let expected = [
        0xf3, 0x45, 0x22, 0x8d, 0xca, 0x59, 0xc6, 0x60, 0x57, 0x89, 0x62, 0x0e, 0x9e, 0xc6, 0x2f,
        0xf4, 0x84, 0x7a, 0x09, 0x27, 0xc3, 0x3d, 0xac, 0x75, 0x81, 0xa9, 0x55, 0xfe, 0x74, 0x60,
        0x16, 0xbe,
    ];
    assert_eq!(
        hash,
        BytesN::from_array(&fx.e, &expected),
        "wrong provider artifact"
    );
    let roles = map![
        &fx.e,
        (0u32, fx.owner.clone()),
        (1u32, fx.owner.clone()),
        (2u32, fx.owner.clone()),
        (3u32, fx.owner.clone())
    ];
    // No strategy: validates real vault ABI/auth/shares/rounding, NOT external lending liquidity.
    let assets = vec![
        &fx.e,
        AssetStrategySet {
            address: fx.usdc.clone(),
            strategies: Vec::new(&fx.e),
        },
    ];
    let metadata = map![
        &fx.e,
        (
            String::from_str(&fx.e, "name"),
            String::from_str(&fx.e, "Local ABI test")
        ),
        (
            String::from_str(&fx.e, "symbol"),
            String::from_str(&fx.e, "TEST")
        )
    ];
    let vault = fx.e.register(
        wasm.as_slice(),
        (
            assets,
            roles,
            100u32,
            fx.owner.clone(),
            2000u32,
            fx.owner.clone(),
            metadata,
            false,
        ),
    );
    assert_eq!(vault.executable(), Some(Executable::Wasm(hash.clone())));
    let v = VaultClient::new(&fx.e, &vault);
    // Seed the real vault; its initial 1000-share liquidity lock is intentionally not mocked away.
    v.deposit(
        &vec![&fx.e, 1_000_000i128],
        &vec![&fx.e, 1_000_000i128],
        &fx.owner,
        &false,
    );
    fx.pool.configure_yield(&vault, &hash);
    fx.pool.lock_shares(&500_000, &500_000, &1000);
    fx.pool.fund(&LOCK);
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr,
            fn_name: "invest",
            args: (LOCK, LOCK, 1000u32).into_val(&fx.e),
            sub_invokes: &[],
        },
    }]);
    fx.pool.invest(&LOCK, &LOCK, &1000);
    assert_eq!(fx.e.auths().len(), 1);
    assert_eq!(fx.pool.get_yield().shares, LOCK + 500_000);
    fx.e.mock_all_auths();
    let agent = fx
        .pool
        .create_agent(&BytesN::random(&fx.e), &LIMIT, &covenant(&fx));
    fx.pool.draw(&agent, &LIMIT);
    assert_eq!(bal(&fx, &agent), LIMIT);
    fx.pool.redeem_shares(&500_000, &500_000, &1000);
    assert_eq!(bal(&fx, &fx.pool_addr), 500_000);
    fx.pool.close(&agent, &fx.owner);
    fx.pool.close_pool();
    assert_eq!(
        token::TokenClient::new(&fx.e, &vault).balance(&fx.pool_addr),
        0
    );
    assert!(token::TokenClient::new(&fx.e, &vault).balance(&fx.owner) > 0);
    assert!(fx.pool.get_pool().closed);
}

// A funded, single-vault strategy fixture. This models lending proceeds with
// actual token transfers, not a fabricated exchange rate. Never deployed.
#[contracttype]
#[derive(Clone)]
enum LendingKey {
    Asset,
    Vault,
}
#[contract]
struct LendingFixture;
#[contractimpl]
impl LendingFixture {
    pub fn __constructor(e: Env, asset: Address) {
        e.storage().instance().set(&LendingKey::Asset, &asset);
    }
    pub fn asset(e: Env) -> Address {
        e.storage().instance().get(&LendingKey::Asset).unwrap()
    }
    pub fn balance(e: Env, from: Address) -> i128 {
        let vault: Option<Address> = e.storage().instance().get(&LendingKey::Vault);
        if vault != Some(from) {
            return 0;
        }
        token::TokenClient::new(&e, &Self::asset(e.clone())).balance(&e.current_contract_address())
    }
    pub fn deposit(e: Env, amount: i128, from: Address) -> i128 {
        from.require_auth();
        assert!(amount > 0);
        let vault: Option<Address> = e.storage().instance().get(&LendingKey::Vault);
        assert!(vault.is_none() || vault == Some(from.clone()));
        e.storage().instance().set(&LendingKey::Vault, &from);
        token::TokenClient::new(&e, &Self::asset(e.clone())).transfer(
            &from,
            &e.current_contract_address(),
            &amount,
        );
        Self::balance(e, from)
    }
    pub fn withdraw(e: Env, amount: i128, from: Address, to: Address) -> i128 {
        from.require_auth();
        assert!(amount > 0 && amount <= Self::balance(e.clone(), from.clone()));
        token::TokenClient::new(&e, &Self::asset(e.clone())).transfer(
            &e.current_contract_address(),
            &to,
            &amount,
        );
        Self::balance(e, from)
    }
}

fn artifact(e: &Env, variable: &str, expected: &str) -> std::vec::Vec<u8> {
    let bytes = std::fs::read(std::env::var(variable).expect(variable)).unwrap();
    let digest = e.crypto().sha256(&Bytes::from_slice(e, &bytes)).to_array();
    let hex: std::string::String = digest.iter().map(|b| std::format!("{b:02x}")).collect();
    assert_eq!(hex, expected, "wrong provider artifact");
    bytes
}

#[test]
#[ignore = "requires KOVAN_DEFINDEX_WASM and KOVAN_DEFINDEX_FACTORY_WASM; see docs/YIELD.md"]
fn published_defindex_native_factory_strategy_gains_and_external_position() {
    let pool_wasm = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../target/wasm32v1-none/release/kovan_pool.wasm"),
    )
    .expect("run make build first");
    let fx = setup_with_pool_wasm(Some(&pool_wasm));
    let vault_wasm = artifact(
        &fx.e,
        "KOVAN_DEFINDEX_WASM",
        "f345228dca59c6605789620e9ec62ff4847a0927c33dac7581a955fe746016be",
    );
    let factory_wasm = artifact(
        &fx.e,
        "KOVAN_DEFINDEX_FACTORY_WASM",
        "baba1e5e12e7f83b49f6f2b6b17f7bc672e38c08dca74f77d66d569c522cfec8",
    );
    let hash = fx.e.deployer().upload_contract_wasm(vault_wasm.as_slice());
    let factory = fx.e.register(
        factory_wasm.as_slice(),
        (fx.owner.clone(), fx.owner.clone(), 0u32, hash.clone()),
    );
    let strategy = fx.e.register(LendingFixture, (fx.usdc.clone(),));
    let assets = vec![
        &fx.e,
        AssetStrategySet {
            address: fx.usdc.clone(),
            strategies: vec![
                &fx.e,
                crate::yield_source::Strategy {
                    address: strategy.clone(),
                    name: String::from_str(&fx.e, "Lending fixture"),
                    paused: false,
                },
            ],
        },
    ];
    // Same argument order/types as buildCreateNativeVaultOp. Seed atomically.
    let vault: Address = fx.e.invoke_contract(
        &factory,
        &Symbol::new(&fx.e, "create_defindex_vault_deposit"),
        (
            fx.owner.clone(),
            map![
                &fx.e,
                (0u32, fx.owner.clone()),
                (1u32, fx.owner.clone()),
                (2u32, fx.owner.clone()),
                (3u32, fx.owner.clone())
            ],
            0u32,
            assets,
            fx.owner.clone(),
            map![
                &fx.e,
                (
                    String::from_str(&fx.e, "name"),
                    String::from_str(&fx.e, "Kovan USDC Yield")
                ),
                (
                    String::from_str(&fx.e, "symbol"),
                    String::from_str(&fx.e, "kvUSDC")
                )
            ],
            false,
            vec![&fx.e, 1_000_000i128],
        )
            .into_val(&fx.e),
    );
    assert_eq!(vault.executable(), Some(Executable::Wasm(hash.clone())));
    assert_eq!(bal(&fx, &vault), 1_000_000); // Creating a vault alone is not yield.
    let instruction: Val = (
        Symbol::new(&fx.e, "Invest"),
        strategy.clone(),
        1_000_000i128,
    )
        .into_val(&fx.e);
    fx.e.invoke_contract::<Val>(
        &vault,
        &Symbol::new(&fx.e, "rebalance"),
        (fx.owner.clone(), vec![&fx.e, instruction]).into_val(&fx.e),
    );
    assert_eq!(bal(&fx, &vault), 0);
    assert_eq!(bal(&fx, &strategy), 1_000_000);

    fx.pool.configure_yield(&vault, &hash);
    fx.pool.lock_shares(&500_000, &500_000, &1000);
    assert_eq!(bal(&fx, &strategy), 1_000_000); // Existing shares keep earning in place.
    fx.pool.fund(&LOCK);
    fx.e.mock_auths(&[MockAuth {
        address: &fx.owner,
        invoke: &MockAuthInvoke {
            contract: &fx.pool_addr,
            fn_name: "invest",
            args: (LOCK, LOCK, 1000u32).into_val(&fx.e),
            sub_invokes: &[],
        },
    }]);
    fx.pool.invest(&LOCK, &LOCK, &1000);
    assert_eq!(fx.e.auths().len(), 1);
    assert_eq!(bal(&fx, &strategy), LOCK + 1_000_000); // Future deposits follow strategy.
    assert_eq!(bal(&fx, &vault), 0);
    fx.e.mock_all_auths();
    let agent = fx
        .pool
        .create_agent(&BytesN::random(&fx.e), &LIMIT, &covenant(&fx));
    let before = fx.pool.get_yield();
    // Fund 10% strategy revenue from remaining owner funds, as a stand-in for borrowers.
    token::TokenClient::new(&fx.e, &fx.usdc).transfer(&fx.owner, &strategy, &5_100_000);
    let after = fx.pool.get_yield();
    assert_eq!(after.shares, before.shares);
    assert_eq!(after.estimated_assets, before.estimated_assets * 11 / 10);
    assert_eq!(fx.pool.get_agent(&agent).draw_limit, LIMIT);
    // Auth-observation bookkeeping uses the test host's cumulative shadow
    // budget. Reset that limit; SDK per-invocation resource enforcement stays
    // enabled, including the 400M instruction / 40MiB network limits.
    fx.e.cost_estimate().budget().reset_unlimited();
    fx.pool.draw(&agent, &LIMIT); // Redeems through the actual vault into strategy cash.
    assert!(fx.e.cost_estimate().budget().cpu_instruction_cost() < 400_000_000);
    assert!(fx.e.cost_estimate().budget().memory_bytes_cost() < 41_943_040);
    assert_eq!(bal(&fx, &agent), LIMIT);
    fx.pool.close(&agent, &fx.owner);
    fx.pool.close_pool();
    assert_eq!(
        token::TokenClient::new(&fx.e, &vault).balance(&fx.pool_addr),
        0
    );
    assert!(token::TokenClient::new(&fx.e, &vault).balance(&fx.owner) > 0);
    assert!(fx.pool.get_pool().closed);
}
