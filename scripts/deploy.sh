#!/usr/bin/env bash
# Publish tested mandate-capable artifacts without using an owner's key.
# Usage: DEPLOYER=<dedicated testnet CLI identity> make deploy
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEPLOYER:?Set DEPLOYER to a dedicated testnet deployment identity; owner actions require wallet approval}"
if [[ " ${*} " != *" --check "* ]]; then
  make test
fi
npm --prefix sdk run build
npm --prefix sdk test
exec node dashboard/scripts/publish-contracts.mjs --source "$DEPLOYER" "$@"
