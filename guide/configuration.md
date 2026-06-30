# Configuration

fouine reads configuration from environment variables. Some settings (API key, model, prompt) can also be set via the dashboard, which takes precedence over env vars.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `DATA_DIR` | no | `./data` | Directory for SQLite DB, bare repos, worktrees |
| `DB_PATH` | no | `${DATA_DIR}/fouine.db` | SQLite database path |
| `BASIC_AUTH_USER` | no | — | HTTP Basic Auth username for the dashboard |
| `BASIC_AUTH_PASSWORD` | no | — | HTTP Basic Auth password for the dashboard |
| `GITHUB_APP_ID` | **yes** | — | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | yes* | — | App private key (literal `\n` are un-escaped) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | yes* | — | Path to the `.pem` file |
| `GITHUB_WEBHOOK_SECRET` | **yes** | — | Webhook secret for signature verification |
| `OPENCODE_API_KEY` | recommended | — | OpenCode provider API key |
| `OPENCODE_MODEL` | no | `opencode-go/glm-5.2` | Default model for reviews |
| `REVIEW_TIMEOUT_MS` | no | `600000` (10 min) | Max review duration in milliseconds |
| `OPENCODE_CONFIG_DIR` | no | — | Path to OpenCode config (tools directory) |

\* Provide the private key via one of the two variables. `*_PATH` is recommended.

## Dashboard settings

The dashboard (accessible at your server URL) allows setting:

- **OpenCode API key** — overrides `OPENCODE_API_KEY`
- **Default model** — overrides `OPENCODE_MODEL`
- **Default prompt** — the base review prompt used for all repos without a custom prompt

## Per-repo settings

Each registered repo can have:

- **Custom prompt** — overrides the default prompt for that repo
- **Custom model** — overrides the default model for that repo
- **Enabled/disabled** — toggle reviews without removing the repo

## Basic auth

When both `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are set, the dashboard and `/api` endpoints require HTTP Basic Auth. The webhook endpoint (`/webhook/github`) and `/health` are always exempt.

## Data directory structure

```
${DATA_DIR}/
├── fouine.db          # SQLite database
├── fouine.db-shm      # SQLite shared memory
├── fouine.db-wal      # SQLite write-ahead log
└── repos/             # Bare repo clones (cached)
    └── github.com/
        └── owner/
            └── repo.git/
```
