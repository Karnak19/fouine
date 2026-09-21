#
# Layout follows turborepo's Docker guide (turborepo.dev/docs/guides/tools/docker):
# `turbo prune --docker` splits the monorepo into out/json (manifests only, for
# a cacheable install) and out/full (sources). Installing INSIDE the image is
# what gives every workspace package its own node_modules — bun's isolated
# linker puts @fouine/shared's deps under packages/shared/node_modules, which a
# git checkout never carries, and copying that folder from the repo is how the
# 2026-09-21 deploy broke on `@json-render/core` from packages/shared.

FROM oven/bun:1.4-debian AS base
WORKDIR /app

FROM base AS prepare
COPY . .
RUN bunx turbo prune @fouine/server @fouine/web --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
# prune copies only the root manifests; every workspace tsconfig extends this.
COPY tsconfig.base.json .
RUN bunx turbo run build --filter=@fouine/web

FROM base AS runner
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl bash \
    && rm -rf /var/lib/apt/lists/*

# ponytail: keep in sync with @opencode-ai/sdk in package.json
ARG OPENCODE_VERSION=1.18.30
RUN curl -fsSL https://opencode.ai/install | VERSION="$OPENCODE_VERSION" bash \
    && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && opencode --version

# The pruned tree, installed and built: node_modules at root and per workspace,
# @fouine/shared as TypeScript source (bun imports it directly, no build), the
# server source, and apps/web/dist next to apps/server so app.ts resolves it
# from import.meta.dir (../../../web/dist).
COPY --from=builder /app .

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    OPENCODE_CONFIG_DIR=/app/apps/server/opencode-config

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "apps/server/src/index.ts"]
