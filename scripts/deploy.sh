#!/usr/bin/env bash
# Deploys Kovan to Stellar TESTNET. Testnet only. Never point this at mainnet.
# Usage: OWNER=kova-deployer scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NETWORK=testnet
OWNER=${OWNER:-kova-deployer}
USDC_SAC_ID=${USDC_SAC_ID:-CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA}
WASM=contracts/target/wasm32v1-none/release
OUT=deployments/testnet.json

make build >/dev/null
OWNER_ADDR=$(stellar keys address "$OWNER")
echo "owner: $OWNER ($OWNER_ADDR)"

deploy() { # name wasm [-- ctor args...]
  local alias=$1 wasm=$2; shift 2
  stellar contract deploy --wasm "$wasm" --source "$OWNER" --network $NETWORK --alias "$alias" "$@" 2>/dev/null
}

VERIFIER_ID=$(deploy kovan-verifier $WASM/kovan_ed25519_verifier.wasm)
echo "verifier: $VERIFIER_ID"
POLICY_ID=$(deploy kovan-policy $WASM/kovan_covenant_policy.wasm)
echo "policy:   $POLICY_ID"
ACCOUNT_WASM_HASH=$(stellar contract upload --wasm $WASM/kovan_agent_account.wasm --source "$OWNER" --network $NETWORK 2>/dev/null)
echo "account wasm hash: $ACCOUNT_WASM_HASH"
POOL_ID=$(deploy kovan-pool $WASM/kovan_pool.wasm -- \
  --owner "$OWNER_ADDR" --usdc "$USDC_SAC_ID" --account_wasm_hash "$ACCOUNT_WASM_HASH" \
  --policy "$POLICY_ID" --verifier "$VERIFIER_ID")
echo "pool:     $POOL_ID"
POOL_WASM_HASH=$(sha256sum "$WASM/kovan_pool.wasm" | cut -d ' ' -f 1)

python3 - "$OUT" "$VERIFIER_ID" "$POLICY_ID" "$ACCOUNT_WASM_HASH" "$POOL_ID" "$POOL_WASM_HASH" "$USDC_SAC_ID" "$OWNER_ADDR" <<'PY'
import json, sys, datetime
out, verifier, policy, wasm, pool, pool_wasm, usdc, owner = sys.argv[1:]
json.dump({
  "network": "testnet",
  "verifier": verifier, "policy": policy, "account_wasm_hash": wasm, "pool": pool,
  "pool_wasm_hash": pool_wasm,
  "usdc": usdc, "owner": owner,
  "deployed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
}, open(out, "w"), indent=2)
print(f"wrote {out}")
PY
for id in $VERIFIER_ID $POLICY_ID $POOL_ID; do echo "https://stellar.expert/explorer/testnet/contract/$id"; done
