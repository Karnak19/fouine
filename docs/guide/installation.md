# Installation

## Docker Compose (recommended)

```bash
git clone https://github.com/basilevernouillet/fouine.git
cd fouine
cp .env.example .env
# edit .env with your GitHub App credentials and OpenCode key
docker compose up -d
```

fouine runs on `http://localhost:3000`. Data (SQLite DB, bare repos, worktrees) is stored in the `./data` volume.

## Coolify

Use the Coolify-specific compose file:

```bash
docker compose -f compose.coolify.yml up -d
```

This uses a named Docker volume (`fouine-data`) instead of a bind mount, and sets `XDG_DATA_HOME` so OpenCode sessions survive redeploys.

Configure environment variables in the Coolify UI instead of `.env`.

## Manual (development)

Requires [Bun](https://bun.sh) installed.

```bash
git clone https://github.com/basilevernouillet/fouine.git
cd fouine
bun install

# also install the OpenCode CLI
curl -fsSL https://opencode.ai/install | bash

# configure
cp .env.example .env
# edit .env

# run
bun run dev
```

::: warning
The OpenCode CLI must be available in `PATH` for reviews to work. The Docker image handles this automatically.
:::

## Environment variables

See the [Configuration](/guide/configuration) page for the full reference.

## Health check

```bash
curl http://localhost:3000/health
```

Returns `200 OK` when the server is running.
