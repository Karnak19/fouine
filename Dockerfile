# syntax=docker/dockerfile:1

FROM oven/bun:1.3-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3-debian
WORKDIR /app

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl bash \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://opencode.ai/install | bash \
    && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && opencode --version

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json bunfig.toml ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "src/index.ts"]
