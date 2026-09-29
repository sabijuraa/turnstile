#!/usr/bin/env bash
# Shared helpers for the infra scripts. Source it, do not run it.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker-compose.yml"
AGAVE_VERSION="4.0.2"

POSTGRES_PORT="${POSTGRES_PORT:-5433}"
VALIDATOR_RPC_PORT="${VALIDATOR_RPC_PORT:-8899}"
VALIDATOR_WS_PORT="${VALIDATOR_WS_PORT:-8900}"
export POSTGRES_PORT VALIDATOR_RPC_PORT VALIDATOR_WS_PORT

# Read by the scripts that source this file.
# shellcheck disable=SC2034
LOCAL_DATABASE_URL="postgres://turnstile:turnstile@127.0.0.1:${POSTGRES_PORT}/turnstile"
# shellcheck disable=SC2034
LOCAL_RPC_URL="http://127.0.0.1:${VALIDATOR_RPC_PORT}"
# shellcheck disable=SC2034
LOCAL_WS_URL="ws://127.0.0.1:${VALIDATOR_WS_PORT}"

log() {
  printf '[%s] %s\n' "$(basename "$0")" "$*" >&2
}

die() {
  printf '[%s] error: %s\n' "$(basename "$0")" "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1" hint="$2"
  command -v "${cmd}" >/dev/null 2>&1 || die "${cmd} is not installed. ${hint}"
}

# Compose runs the Node containers as the calling user so they can read and
# write the bind-mounted keys and deployments folders.
prepare_host_dirs() {
  mkdir -p "${REPO_ROOT}/keys/localnet" "${REPO_ROOT}/deployments" "${REPO_ROOT}/target/deploy"
  chmod 700 "${REPO_ROOT}/keys/localnet"
  TURNSTILE_UID="$(id -u)"
  TURNSTILE_GID="$(id -g)"
  export TURNSTILE_UID TURNSTILE_GID
}

# Builds the validator image from a local Agave install when one with the
# pinned version is present, so a slow network does not fetch 218 MB again.
compose_files() {
  COMPOSE_ARGS=(-f "${COMPOSE_FILE}")
  local agave_home="${AGAVE_HOME:-}"
  if [[ -z "${agave_home}" ]] && command -v solana-test-validator >/dev/null 2>&1; then
    if [[ "$(solana-test-validator --version 2>/dev/null)" == *" ${AGAVE_VERSION} "* ]]; then
      agave_home="$(cd "$(dirname "$(command -v solana-test-validator)")/.." && pwd)"
    fi
  fi
  if [[ -n "${agave_home}" && -x "${agave_home}/bin/solana-test-validator" ]]; then
    export AGAVE_HOME="${agave_home}"
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/infra/docker-compose.agave-local.yml")
  fi
}

compose() {
  require_cmd docker "Install Docker with the compose plugin."
  compose_files
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

require_programs() {
  local missing=()
  for name in agent_wallet settlement; do
    [[ -f "${REPO_ROOT}/target/deploy/${name}.so" ]] || missing+=("target/deploy/${name}.so")
  done
  if ((${#missing[@]} > 0)); then
    die "missing ${missing[*]}. Build the programs first with 'cargo build-sbf --manifest-path programs/<program>/Cargo.toml'."
  fi
  check_program_sizes
}

# Builds each Solana program on its own into target/deploy. A workspace wide
# build (anchor build or cargo build-sbf at the root) unifies features and turns
# on agent_wallet's cpi feature, which produces a broken agent_wallet.so.
build_programs() {
  require_cmd cargo-build-sbf "Install the Agave ${AGAVE_VERSION} release so cargo build-sbf is on PATH."
  local program
  for program in agent-wallet settlement; do
    [[ -f "${REPO_ROOT}/programs/${program}/Cargo.toml" ]] \
      || die "programs/${program}/Cargo.toml is missing, so the program cannot be built."
    log "building programs/${program} with cargo build-sbf"
    (cd "${REPO_ROOT}" && cargo build-sbf --manifest-path "programs/${program}/Cargo.toml" --sbf-out-dir target/deploy)
  done
  check_program_sizes
}

# A program built with the wrong features comes out as a stub of a few hundred
# bytes that the loader rejects. Catch it here instead of at genesis.
check_program_sizes() {
  local name size
  for name in agent_wallet settlement; do
    size="$(stat -c %s "${REPO_ROOT}/target/deploy/${name}.so")"
    ((size > 16384)) || die "target/deploy/${name}.so is only ${size} bytes, so the build is broken. Rebuild it with cargo build-sbf --manifest-path programs/<program>/Cargo.toml."
  done
}
