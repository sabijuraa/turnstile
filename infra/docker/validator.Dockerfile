# Solana test validator image pinned to the Agave 4.0.2 release.
#
# The release tarball is downloaded from GitHub and checked against the sha256
# published with the v4.0.2 release. On a slow network, reuse an Agave 4.0.2
# install that is already on the machine by overriding the agave-release stage
# with a named build context that contains bin/solana-test-validator:
#   docker compose build (additional_contexts in docker-compose.yml)
#   docker buildx build --build-context agave-release=$HOME/.local/share/solana/install/active_release ...
# The final stage checks the version either way.

ARG DEBIAN_IMAGE=debian:bookworm-slim

FROM ${DEBIAN_IMAGE} AS agave-download
ARG AGAVE_VERSION=4.0.2
ARG AGAVE_SHA256=ec92ded45536d82c737b4df70404bbc052ec1711773ecb56a240c11d0d71937a
ARG AGAVE_URL=https://github.com/anza-xyz/agave/releases/download/v${AGAVE_VERSION}/solana-release-x86_64-unknown-linux-gnu.tar.bz2
RUN apt-get update \
  && apt-get install -y --no-install-recommends bzip2 ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 8 --retry-all-errors --connect-timeout 30 -o /tmp/agave.tar.bz2 "${AGAVE_URL}" \
  && echo "${AGAVE_SHA256}  /tmp/agave.tar.bz2" | sha256sum -c - \
  && mkdir -p /out \
  && tar -xjf /tmp/agave.tar.bz2 -C /tmp \
  && mv /tmp/solana-release/bin /out/bin \
  && rm -rf /tmp/agave.tar.bz2 /tmp/solana-release

FROM scratch AS agave-release
COPY --from=agave-download /out/ /

FROM ${DEBIAN_IMAGE} AS runtime
ARG AGAVE_VERSION=4.0.2
RUN apt-get update \
  && apt-get install -y --no-install-recommends bzip2 ca-certificates libstdc++6 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 solana \
  && useradd --system --uid 10001 --gid solana --home-dir /home/solana --create-home solana \
  && mkdir -p /ledger /programs \
  && chown solana:solana /ledger
COPY --from=agave-release /bin/solana-test-validator /bin/solana /bin/solana-keygen /usr/local/bin/
RUN solana-test-validator --version | grep -q " ${AGAVE_VERSION} " \
  || { echo "Expected Agave ${AGAVE_VERSION} but found $(solana-test-validator --version)" >&2; exit 1; }
COPY infra/docker/validator-entrypoint.sh /usr/local/bin/validator-entrypoint
USER solana
WORKDIR /home/solana
VOLUME ["/ledger"]
EXPOSE 8899 8900 9900
HEALTHCHECK --interval=5s --timeout=5s --start-period=60s --retries=30 \
  CMD solana cluster-version -u "http://127.0.0.1:${RPC_PORT:-8899}" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/validator-entrypoint"]
