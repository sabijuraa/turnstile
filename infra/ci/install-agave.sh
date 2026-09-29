#!/usr/bin/env bash
# Installs the pinned Agave release from GitHub and checks its sha256.
# Safe to run again. Prints the bin folder to add to PATH.
#
#   infra/ci/install-agave.sh [install_root]
set -euo pipefail

AGAVE_VERSION="${AGAVE_VERSION:-4.0.2}"
AGAVE_SHA256="${AGAVE_SHA256:-ec92ded45536d82c737b4df70404bbc052ec1711773ecb56a240c11d0d71937a}"
install_root="${1:-${HOME}/.local/share/solana/install}"
release_dir="${install_root}/releases/${AGAVE_VERSION}"
bin_dir="${release_dir}/solana-release/bin"

if [[ -x "${bin_dir}/solana-test-validator" ]] \
  && [[ "$("${bin_dir}/solana-test-validator" --version)" == *" ${AGAVE_VERSION} "* ]]; then
  echo "install-agave: Agave ${AGAVE_VERSION} is already installed in ${release_dir}." >&2
else
  url="https://github.com/anza-xyz/agave/releases/download/v${AGAVE_VERSION}/solana-release-x86_64-unknown-linux-gnu.tar.bz2"
  tarball="$(mktemp --suffix=.tar.bz2)"
  trap 'rm -f "${tarball}"' EXIT
  echo "install-agave: downloading ${url}" >&2
  curl --fail --silent --show-error --location --retry 8 --retry-all-errors --connect-timeout 30 \
    --output "${tarball}" "${url}"
  echo "${AGAVE_SHA256}  ${tarball}" | sha256sum --check --quiet - \
    || { echo "install-agave: checksum mismatch for ${url}. Refusing to install it." >&2; exit 1; }
  rm -rf "${release_dir}"
  mkdir -p "${release_dir}"
  tar -xjf "${tarball}" -C "${release_dir}"
  [[ "$("${bin_dir}/solana-test-validator" --version)" == *" ${AGAVE_VERSION} "* ]] \
    || { echo "install-agave: the unpacked release does not report version ${AGAVE_VERSION}." >&2; exit 1; }
fi

ln -sfn "${release_dir}/solana-release" "${install_root}/active_release"
echo "${install_root}/active_release/bin"
