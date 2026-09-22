# Installation

## Docker Compose (recommended)

```bash
git clone https://github.com/Karnak19/fouine.git
cd fouine
cp .env.example .env
# edit .env with your GitHub App credentials and OpenCode key
docker compose up -d
```

fouine runs on `http://localhost:3000`. Data (SQLite DB, bare repos, worktrees) is stored in the `./data` volume.

The bundled `docker-compose.yml` also starts an **OpenCode sidecar** (`opencode`) — see below. Set `OPENCODE_SERVER_PASSWORD` (any strong random string) in `.env` so fouine and the sidecar share one Basic-auth password; it is the only value that must match between them.

## OpenCode: child mode vs sidecar mode

Reviews run against **one long-lived OpenCode server** (one session per review). fouine supports two ways to provide it:

- **Child mode (default).** fouine spawns its own `opencode serve` inside its container. The root `Dockerfile` installs the CLI, so nothing extra is needed. This is what runs when `OPENCODE_BASE_URL` is **unset** — dev, `docker run`, and `compose.coolify.yml`.
- **Sidecar mode.** When `OPENCODE_BASE_URL` is set, fouine spawns nothing and talks to that server instead. `docker-compose.yml` uses this: it builds `Dockerfile.opencode` (the official `ghcr.io/anomalyco/opencode` image **plus `git`**, which the official image lacks) and passes `OPENCODE_BASE_URL=http://opencode:4096` to fouine.

To switch: set/unset `OPENCODE_BASE_URL` (and keep `OPENCODE_SERVER_PASSWORD` identical on both sides in sidecar mode). Remove the `opencode` service and the `OPENCODE_BASE_URL` line to go back to child mode in Compose.

::: warning Sidecar volume path must match
Both containers mount the same volume at the **same absolute path** (`./data:/data`). A review's worktree is created under `/data/worktrees/…`, and that absolute path is handed to the sidecar as the session directory — if the two containers disagree on the path, every review fails. The sidecar also needs `git` for exactly this reason.
:::

Only fouine publishes a host port; the sidecar is reachable on the Compose network only.

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
git clone https://github.com/Karnak19/fouine.git
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
