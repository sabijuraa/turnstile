#!/usr/bin/env bash
# Builds and runs the whole product with docker compose.
#
#   infra/scripts/stack.sh up            build images, start everything, wait until healthy
#   infra/scripts/stack.sh down          stop everything, keep the ledger and database volumes
#   infra/scripts/stack.sh down --volumes    stop everything and delete the volumes
#   infra/scripts/stack.sh logs [service]
#   infra/scripts/stack.sh ps
set -euo pipefail

# shellcheck source=infra/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  sed -n '2,8p' "$0" >&2
}

(($# >= 1)) || {
  usage
  exit 2
}
command="$1"
shift

case "${command}" in
  up)
    prepare_host_dirs
    if [[ ! -f "${REPO_ROOT}/target/deploy/agent_wallet.so" || ! -f "${REPO_ROOT}/target/deploy/settlement.so" ]]; then
      build_programs
    fi
    require_programs
    log "building images and starting the stack. The first build downloads every dependency and takes a while."
    if ! compose up -d --build --wait --wait-timeout "${STACK_WAIT_TIMEOUT:-600}" "$@"; then
      compose ps --all >&2 || true
      die "the stack did not become healthy. Inspect it with 'infra/scripts/stack.sh logs <service>'."
    fi
    compose ps
    cat <<EOF
Turnstile is running.
  web          http://localhost:3000
  facilitator  http://127.0.0.1:4020
  demo-api     http://127.0.0.1:4021
  backend      http://127.0.0.1:4022
  indexer      http://127.0.0.1:4023
  demo-agent   http://127.0.0.1:4024
  validator    ${LOCAL_RPC_URL}
  postgres     ${LOCAL_DATABASE_URL}
EOF
    ;;
  down)
    compose down --remove-orphans "$@"
    ;;
  logs)
    compose logs --no-color --tail "${LOG_TAIL:-200}" "$@"
    ;;
  ps)
    compose ps --all "$@"
    ;;
  *)
    usage
    die "unknown command '${command}'. Use up, down, logs or ps."
    ;;
esac
