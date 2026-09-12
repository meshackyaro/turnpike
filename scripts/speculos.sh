#!/usr/bin/env bash
# Boots Ledger's official emulator with the Ethereum app. No hardware needed.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.speculos"
ELF="app-1.22.3-nanox.elf"
SEED="${SPECULOS_SEED:-glory promote mansion idle axis finger extra february uncover one trip resource lawn turtle enact monster seven myth punch hobby comfort wild raise skin}"

mkdir -p "$DIR"
if [ ! -f "$DIR/$ELF" ]; then
  echo "fetching the Ethereum app…"
  gh release download 1.22.3 --repo LedgerHQ/app-ethereum \
    --pattern "$ELF" --dir "$DIR" --clobber
fi

docker rm -f speculos >/dev/null 2>&1 || true
docker run -d --name speculos \
  -v "$DIR":/app -p 5000:5000 -p 9999:9999 \
  ghcr.io/ledgerhq/speculos:latest \
  --model nanox --display headless --api-port 5000 --apdu-port 9999 \
  --seed "$SEED" "/app/$ELF" >/dev/null

echo "speculos up — API :5000, APDU :9999"
