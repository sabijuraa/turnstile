# One image recipe for every Node workspace package in Turnstile.
#
# Pick the package with SERVICE_DIR, for example packages/facilitator or apps/web.
# The build stage installs the whole workspace from the lockfile, builds the
# package and its workspace dependencies, then reinstalls production
# dependencies only. The runtime stage holds just that package, its workspace
# dependencies and their node_modules, and runs as the unprivileged node user.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=11.24.0
ENV PNPM_HOME=/pnpm \
  PATH=/pnpm:$PATH \
  CI=true \
  NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}" \
  && pnpm --version
WORKDIR /repo

# Download every package in the lockfile into the store. The store is part of
# this layer, so it is reused whenever the lockfile is unchanged. A BuildKit
# cache mount would not work here, since a layer restored from a remote cache
# does not bring the mount's contents with it.
FROM base AS fetch
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm config set store-dir /pnpm/store \
  && pnpm config set fetch-retries 6 \
  && pnpm config set fetch-retry-maxtimeout 120000 \
  && pnpm config set fetch-timeout 300000 \
  && pnpm fetch --frozen-lockfile

FROM fetch AS build
ARG SERVICE_DIR
RUN test -n "${SERVICE_DIR}" || { echo "Set the SERVICE_DIR build arg, for example packages/facilitator." >&2; exit 1; }
COPY . .
RUN test -f "${SERVICE_DIR}/package.json" \
  || { echo "${SERVICE_DIR}/package.json is missing. SERVICE_DIR must point at a workspace package." >&2; exit 1; }
RUN pnpm install --offline --frozen-lockfile
# {path}... selects the package and every workspace package it depends on, and
# pnpm builds them in dependency order. A bare path with ... skips the deps.
RUN pnpm --filter "{./${SERVICE_DIR}}..." run build
# Keep production dependencies only, for the package and its workspace deps.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
  && pnpm install --offline --frozen-lockfile --prod --filter "{./${SERVICE_DIR}}..."
# Collect the package, its workspace dependencies and the root node_modules.
RUN mkdir -p /out \
  && cp package.json pnpm-workspace.yaml /out/ \
  && cp -a node_modules /out/node_modules \
  && pnpm --filter "{./${SERVICE_DIR}}..." exec pwd > /tmp/dirs \
  && while read -r dir; do \
       rel="${dir#/repo/}"; \
       mkdir -p "/out/$(dirname "${rel}")"; \
       cp -a "${dir}" "/out/${rel}"; \
       rm -rf "/out/${rel}/src" "/out/${rel}/test" "/out/${rel}/tsconfig.tsbuildinfo"; \
     done < /tmp/dirs \
  && test -d "/out/${SERVICE_DIR}"

FROM ${NODE_IMAGE} AS runtime
ARG SERVICE_DIR
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  SERVICE_DIR=${SERVICE_DIR}
COPY --from=build --chown=node:node /out /app
COPY infra/docker/healthcheck.mjs /usr/local/lib/turnstile/healthcheck.mjs
WORKDIR /app/${SERVICE_DIR}
USER node
CMD ["node", "dist/main.js"]
