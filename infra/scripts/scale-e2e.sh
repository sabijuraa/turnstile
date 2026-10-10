#!/usr/bin/env bash
# Proves NFR5. Runs the end to end suite against two facilitators and two
# console backends behind an nginx round robin balancer, all sharing one
# Postgres and one validator.
#
#   infra/scripts/scale-e2e.sh
#
# The balancer takes the stack's usual ports, 4020 for the facilitator pool and
# 4022 for the backend pool, so the suite needs no special configuration. After
# the suite passes, the script reads each instance's /metrics and fails unless
# every facilitator settled payments and every backend served requests.
# Results land in packages/e2e/results/scale.json. Needs Docker and free ports
# 4020 to 4024 and 4030 to 4033, so stop a running stack first.
set -euo pipefail

# shellcheck source=infra/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=infra/scripts/wait-for.sh
source "${REPO_ROOT}/infra/scripts/wait-for.sh"

NGINX_IMAGE="nginx:1.29-alpine"
LB_CONTAINER="turnstile-scale-lb"
logs_dir="${REPO_ROOT}/target/scale-e2e-logs"
results_file="${REPO_ROOT}/packages/e2e/results/scale.json"

require_cmd curl "Install curl."
require_cmd docker "Install Docker with the compose plugin."

for port in 4020 4021 4022 4023 4024 4030 4031 4032 4033; do
  if curl --silent --max-time 1 --output /dev/null "http://127.0.0.1:${port}/"; then
    die "port ${port} is already in use. Stop the running stack with 'pnpm stack:down' first."
  fi
done

"${REPO_ROOT}/infra/scripts/dev-up.sh"

log "building @turnstile/e2e and the packages it drives"
(cd "${REPO_ROOT}" && pnpm --filter "@turnstile/e2e..." build)

mkdir -p "${logs_dir}" "$(dirname "${results_file}")"
pids=()

common_env=(
  NODE_ENV=production
  LOG_LEVEL="${LOG_LEVEL:-info}"
  TURNSTILE_NETWORK=localnet
  DATABASE_URL="${LOCAL_DATABASE_URL}"
  SOLANA_RPC_URL="${LOCAL_RPC_URL}"
  SOLANA_WS_URL="${LOCAL_WS_URL}"
  DEPLOYMENT_FILE="${REPO_ROOT}/deployments/localnet.json"
  FACILITATOR_URL="http://127.0.0.1:4020"
)

start_service() {
  local name="$1" entry="$2"
  shift 2
  log "starting ${name}"
  env "${common_env[@]}" "$@" node "${REPO_ROOT}/${entry}" \
    >"${logs_dir}/${name}.log" 2>&1 &
  pids+=("$!")
}

teardown() {
  local status=$?
  log "stopping the scale rig"
  docker rm -f "${LB_CONTAINER}" >/dev/null 2>&1 || true
  local pid
  for pid in "${pids[@]:-}"; do
    if [[ -n "${pid}" ]]; then kill "${pid}" >/dev/null 2>&1 || true; fi
  done
  wait >/dev/null 2>&1 || true
  if ((status != 0)); then
    log "service logs are in ${logs_dir#"${REPO_ROOT}"/}"
  fi
  exit "${status}"
}
trap teardown EXIT

keys="${REPO_ROOT}/keys/localnet"
start_service facilitator-a packages/facilitator/dist/main.js \
  PORT=4030 FACILITATOR_PUBLIC_URL=http://127.0.0.1:4020 FACILITATOR_KEYPAIR="${keys}/facilitator.json"
start_service facilitator-b packages/facilitator/dist/main.js \
  PORT=4031 FACILITATOR_PUBLIC_URL=http://127.0.0.1:4020 FACILITATOR_KEYPAIR="${keys}/facilitator.json"
start_service backend-a packages/backend/dist/main.js \
  PORT=4032 WEB_ORIGIN=http://localhost:3000
start_service backend-b packages/backend/dist/main.js \
  PORT=4033 WEB_ORIGIN=http://localhost:3000
start_service indexer packages/indexer/dist/main.js PORT=4023
start_service demo-api packages/demo-api/dist/main.js \
  PORT=4021 DEMO_API_PUBLIC_URL=http://127.0.0.1:4021
start_service demo-agent packages/demo-api/dist/agent-main.js \
  PORT=4024 DEMO_API_URL=http://127.0.0.1:4021 WEB_ORIGIN=http://localhost:3000 \
  DEMO_OWNER_KEYPAIR="${keys}/demo-owner.json" DEMO_SESSION_KEYPAIR="${keys}/demo-session.json"

for port in 4030 4031 4032 4033 4021 4023 4024; do
  wait_for_http "http://127.0.0.1:${port}/readyz" 90
done

log "starting the ${NGINX_IMAGE} balancer on 4020 and 4022"
docker rm -f "${LB_CONTAINER}" >/dev/null 2>&1 || true
docker run --detach --name "${LB_CONTAINER}" --network host \
  --volume "${REPO_ROOT}/infra/docker/scale-nginx.conf:/etc/nginx/nginx.conf:ro" \
  "${NGINX_IMAGE}" >/dev/null
wait_for_http "http://127.0.0.1:4020/healthz" 30
wait_for_http "http://127.0.0.1:4022/healthz" 30

log "running the end to end suite through the balancer"
(
  cd "${REPO_ROOT}"
  export E2E_STACK=full
  export TURNSTILE_NETWORK=localnet
  export SOLANA_RPC_URL="${LOCAL_RPC_URL}"
  export SOLANA_WS_URL="${LOCAL_WS_URL}"
  export DATABASE_URL="${LOCAL_DATABASE_URL}"
  export DEPLOYMENT_FILE="${REPO_ROOT}/deployments/localnet.json"
  export KEYS_DIR="${REPO_ROOT}/keys/localnet"
  export FACILITATOR_URL="http://127.0.0.1:4020"
  export DEMO_API_URL="http://127.0.0.1:4021"
  export BACKEND_URL="http://127.0.0.1:4022"
  export INDEXER_URL="http://127.0.0.1:4023"
  export DEMO_AGENT_URL="http://127.0.0.1:4024"
  pnpm --filter @turnstile/e2e test
)

# The suite passed through the balancer. Now hold every instance to having
# done real work, so a pool that quietly collapsed onto one instance fails.
metric() {
  local port="$1" name="$2"
  curl --silent --fail --max-time 5 "http://127.0.0.1:${port}/metrics" \
    | awk -v name="${name}" '$1 ~ "^"name { sum += $2 } END { printf "%d", sum }'
}

fa_settled="$(metric 4030 'turnstile_facilitator_settlements_total\\{outcome="settled"\\}')"
fb_settled="$(metric 4031 'turnstile_facilitator_settlements_total\\{outcome="settled"\\}')"
ba_requests="$(metric 4032 'turnstile_backend_http_requests_total')"
bb_requests="$(metric 4033 'turnstile_backend_http_requests_total')"

log "facilitator-a settled ${fa_settled}, facilitator-b settled ${fb_settled}"
log "backend-a served ${ba_requests} requests, backend-b served ${bb_requests}"

for check in \
  "facilitator-a settled:${fa_settled}" \
  "facilitator-b settled:${fb_settled}" \
  "backend-a requests:${ba_requests}" \
  "backend-b requests:${bb_requests}"; do
  value="${check##*:}"
  ((value > 0)) || die "${check%%:*} did no work (${check#* }). The pool did not balance."
done

cat >"${results_file}" <<EOF
{
  "measuredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "requirement": "NFR5 two facilitators and two backends behind a round robin balancer share one Postgres and pass the e2e suite",
  "balancer": "${NGINX_IMAGE} on 4020 and 4022",
  "facilitatorSettled": { "a": ${fa_settled}, "b": ${fb_settled} },
  "backendRequests": { "a": ${ba_requests}, "b": ${bb_requests} }
}
EOF
log "wrote ${results_file#"${REPO_ROOT}"/}"
log "horizontal scale run passed"
