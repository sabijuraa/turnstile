#!/usr/bin/env bash
# Brings up the stack and runs the end-to-end suite against it.
#
#   infra/scripts/e2e.sh                 full compose stack, then pnpm --filter @turnstile/e2e test
#   E2E_STACK=infra infra/scripts/e2e.sh validator, postgres, migrations and bootstrap only.
#                                        The suite starts the services itself (CI uses this)
#   E2E_STACK=running infra/scripts/e2e.sh  use a stack that stack.sh up already started,
#                                        and leave it running
#   E2E_KEEP_STACK=1                     leave the stack running afterwards
#
# Service logs are written to target/e2e-logs when the suite fails.
set -euo pipefail

# shellcheck source=infra/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

stack_mode="${E2E_STACK:-full}"
keep_stack="${E2E_KEEP_STACK:-0}"
[[ "${stack_mode}" == "running" ]] && keep_stack="1"
logs_dir="${REPO_ROOT}/target/e2e-logs"

require_cmd pnpm "Install pnpm 11 with 'npm install -g pnpm@11.24.0'."

# Fail before touching docker when the suite does not exist.
e2e_manifest=""
for candidate in "${REPO_ROOT}"/packages/*/package.json "${REPO_ROOT}"/apps/*/package.json "${REPO_ROOT}"/e2e/package.json; do
  [[ -f "${candidate}" ]] || continue
  if node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).name === "@turnstile/e2e" ? 0 : 1)' "${candidate}"; then
    e2e_manifest="${candidate}"
    break
  fi
done
[[ -n "${e2e_manifest}" ]] \
  || die "no workspace package is named @turnstile/e2e, so there is no end-to-end suite to run. Add the e2e package before running this script."
node -e 'const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(p.scripts && p.scripts.test ? 0 : 1)' "${e2e_manifest}" \
  || die "${e2e_manifest#"${REPO_ROOT}"/} has no test script. Add one that runs the end-to-end suite."

collect_logs() {
  mkdir -p "${logs_dir}"
  local service
  for service in validator postgres bootstrap facilitator demo-api demo-agent indexer backend web; do
    compose logs --no-color "${service}" >"${logs_dir}/${service}.log" 2>&1 \
      || log "could not read logs for ${service}"
  done
  log "service logs are in ${logs_dir#"${REPO_ROOT}"/}"
}

# Only stop what this run started. The compose Postgres on 5433 and a validator
# that was already up are shared with everyone working on this machine, so they
# keep running, and no volume is ever deleted here.
already_running=()
if command -v docker >/dev/null 2>&1; then
  mapfile -t already_running < <(compose ps --status running --services 2>/dev/null || true)
fi

teardown() {
  local status=$?
  if ((status != 0)); then
    collect_logs
  fi
  if [[ "${keep_stack}" == "1" ]]; then
    log "leaving the stack running because E2E_KEEP_STACK=1"
  else
    local started=() service
    # Every container that exists now, whatever its state, unless it was
    # already running before this run.
    for service in $(compose ps --all --services 2>/dev/null); do
      [[ " ${already_running[*]} " == *" ${service} "* ]] || started+=("${service}")
    done
    if ((${#started[@]} > 0)); then
      log "stopping ${started[*]}"
      compose stop "${started[@]}" >/dev/null 2>&1 || log "compose stop failed, check 'docker ps'"
    fi
  fi
  exit "${status}"
}
trap teardown EXIT

case "${stack_mode}" in
  full) "${REPO_ROOT}/infra/scripts/stack.sh" up ;;
  infra)
    "${REPO_ROOT}/infra/scripts/dev-up.sh"
    # The suite starts the services itself from their build output.
    log "building @turnstile/e2e and the packages it starts"
    (cd "${REPO_ROOT}" && pnpm --filter "@turnstile/e2e..." build)
    ;;
  running)
    # shellcheck source=infra/scripts/wait-for.sh
    source "${REPO_ROOT}/infra/scripts/wait-for.sh"
    wait_for_solana "${LOCAL_RPC_URL}" 30
    wait_for_postgres "${LOCAL_DATABASE_URL}" 30
    ;;
  *) die "E2E_STACK must be full, infra or running, not '${stack_mode}'." ;;
esac

export TURNSTILE_NETWORK=localnet
export SOLANA_RPC_URL="${LOCAL_RPC_URL}"
export SOLANA_WS_URL="${LOCAL_WS_URL}"
export DATABASE_URL="${LOCAL_DATABASE_URL}"
export DEPLOYMENT_FILE="${REPO_ROOT}/deployments/localnet.json"
export KEYS_DIR="${REPO_ROOT}/keys/localnet"
# The suite knows two modes. A stack that is already running is the full mode.
if [[ "${stack_mode}" == "infra" ]]; then export E2E_STACK=infra; else export E2E_STACK=full; fi
if [[ "${stack_mode}" != "infra" ]]; then
  export FACILITATOR_URL="http://127.0.0.1:4020"
  export DEMO_API_URL="http://127.0.0.1:4021"
  export BACKEND_URL="http://127.0.0.1:4022"
  export INDEXER_URL="http://127.0.0.1:4023"
  export DEMO_AGENT_URL="http://127.0.0.1:4024"
  export WEB_URL="http://127.0.0.1:3000"
fi

log "running pnpm --filter @turnstile/e2e test"
(cd "${REPO_ROOT}" && pnpm --filter @turnstile/e2e test)
log "end-to-end suite passed"
