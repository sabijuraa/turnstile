#!/usr/bin/env bash
# Waits until a dependency answers, or fails with a clear message.
#
#   wait-for.sh tcp HOST:PORT [timeout_seconds]
#   wait-for.sh http URL [timeout_seconds]           any 2xx answer
#   wait-for.sh solana RPC_URL [timeout_seconds]     getHealth returns ok
#   wait-for.sh postgres DATABASE_URL [timeout_seconds]
#
# The script can also be sourced for its wait_for_* functions.
set -euo pipefail

_wait_loop() {
  local label="$1" timeout="$2"
  shift 2
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      printf 'wait-for: %s did not become ready within %ss.\n' "${label}" "${timeout}" >&2
      return 1
    fi
    sleep 1
  done
  printf 'wait-for: %s is ready.\n' "${label}" >&2
}

_tcp_open() {
  local host="$1" port="$2"
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null
}

_http_ok() {
  curl --silent --fail --max-time 3 --output /dev/null "$1"
}

_solana_healthy() {
  local body
  body="$(curl --silent --fail --max-time 3 -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$1")" || return 1
  [[ "${body}" == *'"result":"ok"'* ]]
}

_postgres_ready() {
  local url="$1"
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready --dbname="${url}" --timeout=3
  elif command -v psql >/dev/null 2>&1; then
    psql "${url}" --no-psqlrc --tuples-only --command 'select 1'
  else
    local hostport="${url#*@}"
    hostport="${hostport%%/*}"
    _tcp_open "${hostport%%:*}" "${hostport##*:}"
  fi
}

wait_for_tcp() {
  local target="$1" timeout="${2:-60}"
  [[ "${target}" == *:* ]] || { echo "wait-for: expected HOST:PORT but got '${target}'." >&2; return 2; }
  _wait_loop "tcp ${target}" "${timeout}" _tcp_open "${target%%:*}" "${target##*:}"
}

wait_for_http() {
  local url="$1" timeout="${2:-60}"
  command -v curl >/dev/null 2>&1 || { echo "wait-for: curl is required for http checks." >&2; return 2; }
  _wait_loop "${url}" "${timeout}" _http_ok "${url}"
}

wait_for_solana() {
  local url="$1" timeout="${2:-120}"
  command -v curl >/dev/null 2>&1 || { echo "wait-for: curl is required for solana checks." >&2; return 2; }
  _wait_loop "solana rpc ${url}" "${timeout}" _solana_healthy "${url}"
}

wait_for_postgres() {
  local url="$1" timeout="${2:-60}"
  local where="${url#*@}"
  _wait_loop "postgres ${where%%\?*}" "${timeout}" _postgres_ready "${url}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if (($# < 2)); then
    sed -n '2,9p' "$0" >&2
    exit 2
  fi
  kind="$1"
  shift
  case "${kind}" in
    tcp) wait_for_tcp "$@" ;;
    http) wait_for_http "$@" ;;
    solana) wait_for_solana "$@" ;;
    postgres) wait_for_postgres "$@" ;;
    *)
      echo "wait-for: unknown check '${kind}'. Use tcp, http, solana or postgres." >&2
      exit 2
      ;;
  esac
fi
