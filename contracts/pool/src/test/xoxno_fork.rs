//! Replay captured XOXNO state locally. No network writes or real owner keys.
use super::*;
use crate::yield_source::{AssetStrategySet, Strategy, VaultClient};
use soroban_sdk::xdr::{LedgerEntry, Limits, ReadXdr};
use soroban_sdk::{map, Bytes, Executable, String, Symbol, Val};

#[test]
#[ignore = "requires KOVAN_XOXNO_FORK; run dashboard/scripts/capture-xoxno-fork.mjs"]
fn xoxno_deployed_strategy_native_and_imported_shares_draw_and_recover() {
    let dir = std::env::var("KOVAN_XOXNO_FORK").expect("KOVAN_XOXNO_FORK");
    let captured = std::fs::read_to_string(std::format!("{dir}/ledger.txt")).unwrap();
    let mut lines = captured.lines();
    let mut header = lines.next().unwrap().split_whitespace();
    let mut snapshot = Env::default().to_ledger_snapshot();
    snapshot.sequence_number = header.next().unwrap().parse().unwrap();
    snapshot.timestamp = header.next().unwrap().parse().unwrap();
    // Keep this project's host protocol. This is a compatibility replay, not a
    // proof that the local host exactly matches the live network's protocol.
    for line in lines {
        let (ttl, encoded) = line.split_once(' ').unwrap();
        let entry = LedgerEntry::from_xdr_base64(encoded, Limits::none()).unwrap();
        let ttl: u32 = ttl.parse().unwrap();
        snapshot.ledger_entries.push((
            std::boxed::Box::new(entry.to_key()),
            (
                std::boxed::Box::new(entry),
                if ttl == 0 { None } else { Some(ttl) },
            ),
        ));
    }
    let e = Env::from_ledger_snapshot(snapshot);
    // Auth recording has a cumulative shadow budget across test invocations.
    // Per-invocation SDK resource limits remain enabled.
    e.cost_estimate().budget().reset_unlimited();
    e.mock_all_auths();
    let usdc = Address::from_str(
        &e,
        "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    );
    let strategy = Address::from_str(
        &e,
        "CCRU56E3WHFFGEQ7LZ4HEEL6MWVZE7BBHB36H4F6Y27T6GGY4SCR2FMM",
    );
    let strategy_wasm = std::fs::read(std::format!("{dir}/strategy.wasm")).unwrap();
    let strategy_hash = e
        .crypto()
        .sha256(&Bytes::from_slice(&e, &strategy_wasm))
        .to_bytes();
    assert_eq!(strategy.executable(), Some(Executable::Wasm(strategy_hash)));
    let owner = Address::generate(&e);
    // Mint only inside this local snapshot; generated contract address needs no trustline.
    token::StellarAssetClient::new(&e, &usdc).mint(&owner, &100_000_000);
    let policy = e.register(CovenantPolicyContract, ());
    let verifier = e.register(Ed25519VerifierContract, ());
    let account_bytes = std::env::var("KOVAN_XOXNO_ACCOUNT_WASM")
        .map(|path| std::fs::read(path).unwrap())
        .unwrap_or_else(|_| account_wasm::WASM.to_vec());
    let account_hash = e.deployer().upload_contract_wasm(account_bytes.as_slice());
    let pool_path = std::env::var("KOVAN_XOXNO_POOL_WASM")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../target/wasm32v1-none/release/kovan_pool.wasm")
        });
    let pool_wasm = std::fs::read(pool_path).unwrap();
    let pool_addr = e.register(
        pool_wasm.as_slice(),
        (
            owner.clone(),
            usdc.clone(),
            account_hash,
            policy.clone(),
            verifier.clone(),
        ),
    );
    let pool = KovanPoolClient::new(&e, &pool_addr);
    let vault_wasm = std::fs::read(std::format!("{dir}/vault.wasm")).unwrap();
    let vault_hash = e
        .crypto()
        .sha256(&Bytes::from_slice(&e, &vault_wasm))
        .to_bytes();
    let vault = e.register(
        vault_wasm.as_slice(),
        (
            vec![
                &e,
                AssetStrategySet {
                    address: usdc.clone(),
                    strategies: vec![
                        &e,
                        Strategy {
                            address: strategy.clone(),
                            name: String::from_str(&e, "XOXNO"),
                            paused: false,
                        },
                    ],
                },
            ],
            map![
                &e,
                (0u32, owner.clone()),
                (1u32, owner.clone()),
                (2u32, owner.clone()),
                (3u32, owner.clone())
            ],
            0u32,
            owner.clone(),
            2000u32,
            owner.clone(),
            map![
                &e,
                (
                    String::from_str(&e, "name"),
                    String::from_str(&e, "Kovan USDC Yield")
                ),
                (
                    String::from_str(&e, "symbol"),
                    String::from_str(&e, "kvUSDC")
                )
            ],
            false,
        ),
    );
    let v = VaultClient::new(&e, &vault);
    v.deposit(
        &vec![&e, 10_000_000i128],
        &vec![&e, 10_000_000i128],
        &owner,
        &false,
    );
    let instruction: Val =
        (Symbol::new(&e, "Invest"), strategy.clone(), 10_000_000i128).into_val(&e);
    e.invoke_contract::<Val>(
        &vault,
        &Symbol::new(&e, "rebalance"),
        (owner.clone(), vec![&e, instruction]).into_val(&e),
    );
    pool.configure_yield(&vault, &vault_hash);
    let deadline = e.ledger().sequence() + 100;
    pool.lock_shares(&1_000_000, &990_000, &deadline);
    pool.fund(&50_000_000);
    e.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &pool_addr,
            fn_name: "invest",
            args: (50_000_000i128, 49_000_000i128, deadline).into_val(&e),
            sub_invokes: &[],
        },
    }]);
    pool.invest(&50_000_000, &49_000_000, &deadline);
    assert_eq!(e.auths().len(), 1);
    e.mock_all_auths();
    assert_eq!(token::TokenClient::new(&e, &usdc).balance(&pool_addr), 0);
    let agent = pool.create_agent(
        &BytesN::random(&e),
        &5_000_000,
        &CovenantParams {
            pool: pool_addr.clone(),
            usdc: usdc.clone(),
            providers: vec![&e, owner.clone()],
            provider_per_transfer_cap: 1_000_000,
            provider_total_cap: 5_000_000,
            recipients: Vec::new(&e),
            recipient_per_transfer_cap: 0,
            recipient_total_cap: 0,
            calls: Vec::new(&e),
            expiry: deadline,
        },
    );
    // Exercise redemption immediately, including XOXNO's base-unit rounding.
    pool.draw(&agent, &2_500_000);
    assert_eq!(
        token::TokenClient::new(&e, &usdc).balance(&agent),
        2_500_000
    );
    let before = pool.get_yield();
    e.ledger().set_timestamp(e.ledger().timestamp() + 60);
    let after = pool.get_yield();
    assert_eq!(after.shares, before.shares);
    assert!(
        after.estimated_assets > before.estimated_assets,
        "Outstanding XOXNO borrowing should accrue interest to backing"
    );
    e.cost_estimate().budget().reset_unlimited();
    pool.draw(&agent, &2_500_000);
    assert!(e.cost_estimate().budget().cpu_instruction_cost() < 400_000_000);
    assert!(e.cost_estimate().budget().memory_bytes_cost() < 41_943_040);
    assert_eq!(
        token::TokenClient::new(&e, &usdc).balance(&agent),
        5_000_000
    );
    assert_eq!(pool.get_agent(&agent).draw_limit, 5_000_000);
    pool.close(&agent, &owner);
    pool.redeem_shares(&1_000_000, &990_000, &deadline);
    pool.close_pool();
    assert!(pool.get_pool().closed);
    assert_eq!(token::TokenClient::new(&e, &vault).balance(&pool_addr), 0);
    assert!(token::TokenClient::new(&e, &vault).balance(&owner) > 0);
}
