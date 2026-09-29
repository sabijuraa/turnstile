#!/usr/bin/env bash
# Starts the local chain and database, applies migrations and runs the
# localnet bootstrap, so services can run against them from a shell.
#
#   infra/scripts/dev-up.sh             validator and postgres in docker
#   infra/scripts/dev-up.sh --native    solana-test-validator on this machine, postgres in docker
#   infra/scripts/dev-up.sh --reset     start the validator from a fresh ledger
#
# Programs are built into target/deploy first when the .so files are missing.
set -euo pipefail

# shellcheck source=infra/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=infra/scripts/wait-for.sh
source "${REPO_ROOT}/infra/scripts/wait-for.sh"

mode="docker"
reset="0"
for arg in "$@"; do
  case "${arg}" in
    --native) mode="native" ;;
    --reset) reset="1" ;;
    -h | --help)
      sed -n '2,9p' "$0"
      exit 0
      ;;
    *) die "unknown option '${arg}'. Use --native, --reset or --help." ;;
  esac
done

require_cmd node "Install Node 22."
require_cmd pnpm "Install pnpm 11 with 'npm install -g pnpm@11.24.0'."
require_cmd curl "Install curl."
prepare_host_dirs

if [[ ! -f "${REPO_ROOT}/target/deploy/agent_wallet.so" || ! -f "${REPO_ROOT}/target/deploy/settlement.so" ]]; then
  build_programs
fi
require_programs

log "starting postgres on port ${POSTGRES_PORT}"
compose up -d --wait postgres

native_ledger="${REPO_ROOT}/target/localnet-ledger"
native_log="${REPO_ROOT}/target/localnet-validator.log"
if [[ "${mode}" == "docker" ]]; then
  log "starting the validator in docker on port ${VALIDATOR_RPC_PORT}"
  VALIDATOR_RESET="${reset}" compose up -d --wait validator
else
  require_cmd solana-test-validator "Install the Agave ${AGAVE_VERSION} release."
  [[ "$(solana-test-validator --version)" == *" ${AGAVE_VERSION} "* ]] \
    || die "solana-test-validator is not Agave ${AGAVE_VERSION}. Install that release so local and CI chains match."
  if _solana_healthy "${LOCAL_RPC_URL}"; then
    if [[ "${reset}" == "1" ]]; then
      die "a validator already answers on ${LOCAL_RPC_URL}. Stop it before using --reset."
    fi
    log "a validator already answers on ${LOCAL_RPC_URL}, reusing it"
  else
    log "starting solana-test-validator natively, ledger in target/localnet-ledger, log in target/localnet-validator.log"
    RPC_PORT="${VALIDATOR_RPC_PORT}" LEDGER_DIR="${native_ledger}" PROGRAMS_DIR="${REPO_ROOT}/target/deploy" \
      VALIDATOR_RESET="${reset}" nohup "${REPO_ROOT}/infra/docker/validator-entrypoint.sh" \
      >"${native_log}" 2>&1 &
    echo "$!" >"${REPO_ROOT}/target/localnet-validator.pid"
  fi
fi

wait_for_solana "${LOCAL_RPC_URL}" 180 || {
  [[ "${mode}" == "native" ]] && tail -n 40 "${native_log}" >&2
  die "the validator did not become healthy. Check the log above or 'docker compose -f infra/docker-compose.yml logs validator'."
}
wait_for_postgres "${LOCAL_DATABASE_URL}" 60

log "building @turnstile/shared"
(cd "${REPO_ROOT}" && pnpm --filter @turnstile/shared build)

log "applying database migrations"
(cd "${REPO_ROOT}" && DATABASE_URL="${LOCAL_DATABASE_URL}" pnpm --filter @turnstile/shared migrate)

bootstrap_cli="${REPO_ROOT}/packages/shared/dist/cli/bootstrap-localnet.js"
[[ -f "${bootstrap_cli}" ]] \
  || die "${bootstrap_cli#"${REPO_ROOT}"/} is missing. The shared package must ship the localnet bootstrap CLI."
log "bootstrapping localnet keys, mint and deployments/localnet.json"
(
  cd "${REPO_ROOT}/packages/shared"
  TURNSTILE_NETWORK=localnet \
    SOLANA_RPC_URL="${LOCAL_RPC_URL}" \
    SOLANA_WS_URL="${LOCAL_WS_URL}" \
    DATABASE_URL="${LOCAL_DATABASE_URL}" \
    KEYS_DIR="${REPO_ROOT}/keys/localnet" \
    DEPLOYMENT_FILE="${REPO_ROOT}/deployments/localnet.json" \
    node "${bootstrap_cli}"
)
[[ -f "${REPO_ROOT}/deployments/localnet.json" ]] \
  || die "the bootstrap finished but deployments/localnet.json was not written."

cat <<EOF
Local chain and database are ready. Run services against them with:
  export TURNSTILE_NETWORK=localnet
  export SOLANA_RPC_URL=${LOCAL_RPC_URL}
  export SOLANA_WS_URL=${LOCAL_WS_URL}
  export DATABASE_URL=${LOCAL_DATABASE_URL}
  export DEPLOYMENT_FILE=${REPO_ROOT}/deployments/localnet.json
  export KEYS_DIR=${REPO_ROOT}/keys/localnet
EOF
