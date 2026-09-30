#!/usr/bin/env bash
# Starts solana-test-validator with the Turnstile programs loaded at genesis.
set -euo pipefail

RPC_PORT="${RPC_PORT:-8899}"
FAUCET_PORT="${FAUCET_PORT:-9900}"
GOSSIP_PORT="${GOSSIP_PORT:-18001}"
DYNAMIC_PORT_RANGE="${DYNAMIC_PORT_RANGE:-18002-18040}"
LEDGER_DIR="${LEDGER_DIR:-/ledger}"
PROGRAMS_DIR="${PROGRAMS_DIR:-/programs}"
AGENT_WALLET_PROGRAM_ID="${AGENT_WALLET_PROGRAM_ID:-7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb}"
SETTLEMENT_PROGRAM_ID="${SETTLEMENT_PROGRAM_ID:-6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z}"
REQUIRE_PROGRAMS="${REQUIRE_PROGRAMS:-1}"
VALIDATOR_RESET="${VALIDATOR_RESET:-0}"

args=(
  --ledger "${LEDGER_DIR}"
  --rpc-port "${RPC_PORT}"
  --faucet-port "${FAUCET_PORT}"
  --gossip-port "${GOSSIP_PORT}"
  --dynamic-port-range "${DYNAMIC_PORT_RANGE}"
  --limit-ledger-size 50000000
)

present=()
for name in agent_wallet settlement; do
  so="${PROGRAMS_DIR}/${name}.so"
  if [[ -f "${so}" ]]; then
    present+=("${so}")
  elif [[ "${REQUIRE_PROGRAMS}" == "1" ]]; then
    echo "validator: ${so} is missing. Build each program with 'cargo build-sbf --manifest-path programs/<program>/Cargo.toml' so target/deploy holds agent_wallet.so and settlement.so." >&2
    exit 1
  else
    echo "validator: ${so} is missing. Starting without it because REQUIRE_PROGRAMS=${REQUIRE_PROGRAMS}." >&2
  fi
done
fingerprint="none"
if ((${#present[@]} > 0)); then
  fingerprint="$(sha256sum "${present[@]}" | sha256sum | cut -d' ' -f1)"
fi

if [[ -f "${PROGRAMS_DIR}/agent_wallet.so" ]]; then
  args+=(--upgradeable-program "${AGENT_WALLET_PROGRAM_ID}" "${PROGRAMS_DIR}/agent_wallet.so" none)
fi
if [[ -f "${PROGRAMS_DIR}/settlement.so" ]]; then
  args+=(--upgradeable-program "${SETTLEMENT_PROGRAM_ID}" "${PROGRAMS_DIR}/settlement.so" none)
fi

# Genesis options are ignored when a ledger already exists, so a new program
# build needs a fresh ledger. The fingerprint of the loaded .so files decides.
stamp="${LEDGER_DIR}/turnstile-programs.sha256"
if [[ "${VALIDATOR_RESET}" == "1" ]]; then
  echo "validator: VALIDATOR_RESET=1, starting from a fresh ledger." >&2
  args+=(--reset)
elif [[ -f "${stamp}" && "$(cat "${stamp}")" != "${fingerprint}" ]]; then
  echo "validator: program binaries changed since the ledger was created, starting from a fresh ledger." >&2
  args+=(--reset)
fi
mkdir -p "${LEDGER_DIR}"
echo "${fingerprint}" >"${stamp}.next"

# The stamp is written once the validator answers, so a crash during genesis
# does not leave a ledger that claims to hold the new programs.
(
  for _ in $(seq 1 120); do
    if solana cluster-version -u "http://127.0.0.1:${RPC_PORT}" >/dev/null 2>&1; then
      mv "${stamp}.next" "${stamp}"
      exit 0
    fi
    sleep 1
  done
) &

exec solana-test-validator "${args[@]}" "$@"
