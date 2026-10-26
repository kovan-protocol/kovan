//! Opt-in local integration test using the published DeFindex testnet bytecode.
//! See docs/YIELD.md for fetching the pinned artifact. No chain writes occur here.
use super::*;
use crate::yield_source::{AssetStrategySet, VaultClient};
use soroban_sdk::{map, Bytes, Executable, String};

#[test]
#[ignore = "requires KOVAN_DEFINDEX_WASM; download instructions in docs/YIELD.md"]
fn published_defindex_wasm_both_funding_paths_draw_and_recover() {
    let path = std::env::var("KOVAN_DEFINDEX_WASM")
        .expect("set KOVAN_DEFINDEX_WASM to the pinned vault WASM");
    let wasm = std::fs::read(path).unwrap();
    let pool_wasm = std::fs::read(std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../target/wasm32v1-none/release/kovan_pool.wasm")).expect("run make build first");
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
