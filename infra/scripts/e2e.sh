#!/usr/bin/env bash
# Brings up the stack and runs the end-to-end suite against it.
#
#   infra/scripts/e2e.sh                 full compose stack, then pnpm --filter @turnstile/e2e test
#   E2E_STACK=infra infra/scripts/e2e.sh validator, postgres, migrations and bootstrap only,
#                                        for a suite that starts the services itself
#   E2E_KEEP_STACK=1                     leave the stack running afterwards
#
# Service logs are written to target/e2e-logs when the suite fails.
set -euo pipefail

# shellcheck source=infra/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

stack_mode="${E2E_STACK:-full}"
keep_stack="${E2E_KEEP_STACK:-0}"
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

teardown() {
  local status=$?
  if ((status != 0)); then
    collect_logs
  fi
  if [[ "${keep_stack}" == "1" ]]; then
    log "leaving the stack running because E2E_KEEP_STACK=1"
  else
    log "stopping the stack"
    compose down --remove-orphans --volumes >/dev/null 2>&1 || log "compose down failed, check 'docker ps'"
  fi
  exit "${status}"
}
trap teardown EXIT

case "${stack_mode}" in
  full) "${REPO_ROOT}/infra/scripts/stack.sh" up ;;
  infra) "${REPO_ROOT}/infra/scripts/dev-up.sh" --reset ;;
  *) die "E2E_STACK must be full or infra, not '${stack_mode}'." ;;
esac

export TURNSTILE_NETWORK=localnet
export SOLANA_RPC_URL="${LOCAL_RPC_URL}"
export SOLANA_WS_URL="${LOCAL_WS_URL}"
export DATABASE_URL="${LOCAL_DATABASE_URL}"
export DEPLOYMENT_FILE="${REPO_ROOT}/deployments/localnet.json"
export KEYS_DIR="${REPO_ROOT}/keys/localnet"
export E2E_STACK="${stack_mode}"
if [[ "${stack_mode}" == "full" ]]; then
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
