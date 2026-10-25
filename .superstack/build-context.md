# Kovan build context

```yaml
review:
  reviewed_commit: 5910f01
  reviewed_worktree: "uncommitted Task 7 delegation implementation present"
  reviewed_at: 2026-10-25
  security_score: C
  quality_score: C
  ready_for_mainnet: false
  ready_for_testnet_demo: false
  findings:
    - severity: high
      category: correctness
      description: close can be called repeatedly and amend accepts closed records, corrupting sum_limits and future delegated limits.
      fix: Enforce explicit state transitions; reject Closed in close, and allow amend only for an explicitly supported live status. Add double-close and amend-after-close regression tests.
    - severity: high
      category: correctness
      description: Covenant enforcement rejects revoked accounts before routing return_funds or USDC transfers back to the pool, contrary to the always-return invariant.
      fix: Parse the context first and permit only the two return-to-pool shapes before the revoked guard; keep every other revoked action rejected. Test both owner and agent return paths after revocation.
    - severity: high
      category: tooling
      description: The repository pins soroban-sdk 28 but the installed Stellar CLI is 26.1.0; the CLI itself warns that it does not support the live protocol-29 network configuration completely.
      fix: Upgrade and pin Stellar CLI 28.1.0 or another reviewed compatible release at least as new as the SDK major, then rebuild and repeat testnet simulation.
    - severity: medium
      category: testing
      description: Unit tests pass but the core signed AuthPayload path through __check_auth and the covenant policy is still unimplemented; most positive flows use mock_all_auths.
      fix: Complete the planned signed end-to-end tests for allowed, wrong-key, blocked-payee, and over-cap transfers before deployment.
    - severity: medium
      category: observability
      description: No contract events are emitted for funding, agent creation, draw, return, revoke, amend, close, or disputes.
      fix: Add typed contract events for every material state change and assert their exact XDR in tests.
    - severity: medium
      category: resource-safety
      description: Agent, provider, recipient, call, and child vectors have no explicit bounds, and recursive revocation plus linear allowlist scans can exceed ledger-entry or transaction resource limits.
      fix: Define protocol-aware maximum lengths/depths at construction and delegation time and add boundary/resource tests.
    - severity: low
      category: code-quality
      description: cargo fmt --check and cargo clippy --workspace --all-targets -- -D warnings fail.
      fix: Format the workspace and address the current needless-borrow warning; remove the unsafe transmute test fixture by constructing clients from stored Env and Address values per test.
  resolved_during_review:
    - The shared covenant ABI was extracted into kovan-covenant-types at commit 5910f01; the pool WASM now exports only pool functions.
  verification:
    tests: "65 passed"
    wasm_build: "passed"
    wasm_sizes: "verifier 1,283 B; policy 16,557 B; account 45,928 B; pool 17,350 B"
    fmt: "failed"
    clippy: "failed: needless borrow in pool/src/contract.rs:41"
```
