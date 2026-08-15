# syntax=docker/dockerfile:1

FROM oven/bun:1.3-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/docs/package.json ./apps/docs/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-debian AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN cd apps/web && bunx vite build

FROM oven/bun:1.3-debian
WORKDIR /app

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl bash \
    && rm -rf /var/lib/apt/lists/*

# ponytail: keep in sync with @opencode-ai/sdk in package.json
ARG OPENCODE_VERSION=1.18.11
RUN curl -fsSL https://opencode.ai/install | VERSION="$OPENCODE_VERSION" bash \
    && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && opencode --version

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
# apps/web/dist must sit next to apps/server so app.ts resolves it from
# import.meta.dir (../../../web/dist).
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY package.json bun.lock tsconfig.base.json ./
# @fouine/shared ships as TypeScript source — bun imports it directly, no build.
COPY packages ./packages
COPY apps/server ./apps/server

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    OPENCODE_CONFIG_DIR=/app/apps/server/opencode-config

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "apps/server/src/index.ts"]
