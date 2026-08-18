# Configuration

fouine reads configuration from environment variables. Some settings (API key, model, prompt) can also be set via the dashboard, which takes precedence over env vars.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `DATA_DIR` | no | `./data` | Directory for SQLite DB, bare repos, worktrees |
| `DB_PATH` | no | `${DATA_DIR}/fouine.db` | SQLite database path |
| `BETTER_AUTH_SECRET` | no† | — | Secret used to sign login sessions (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | no† | `http://localhost:$PORT` | Public origin of the app (OAuth callback base) |
| `ALLOWED_GITHUB_USERS` | no | — | Comma-separated GitHub usernames allowed to sign in |
| `GITHUB_APP_ID` | **yes** | — | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | yes* | — | App private key (literal `\n` are un-escaped) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | yes* | — | Path to the `.pem` file |
| `GITHUB_WEBHOOK_SECRET` | **yes** | — | Webhook secret for signature verification |
| `GITHUB_APP_CLIENT_ID` | no† | — | The App's OAuth client ID (dashboard login) |
| `GITHUB_APP_CLIENT_SECRET` | no† | — | The App's OAuth client secret |
| `OPENCODE_API_KEY` | recommended | — | OpenCode provider API key |
| `ZAI_API_KEY` | no | — | Z.ai GLM Coding Plan key, used for `zai-coding-plan/*` models |
| `OPENCODE_MODEL` | no | `opencode-go/deepseek-v4-flash` | Default model for reviews |
| `OPENCODE_CHAT_MODEL` | no | `opencode-go/mimo-v2.5` | Model for Chat. Env-only — the dashboard's default-model setting does not apply, since Chat is a cheap high-volume workload |
| `REVIEW_IDLE_TIMEOUT_MS` | no | `300000` (5 min) | Kill a review after this long with no activity from OpenCode |
| `REVIEW_TIMEOUT_MS` | no | `2700000` (45 min) | Absolute backstop on review duration, in milliseconds |
| `REVIEW_INSTALL_TIMEOUT_MS` | no | `300000` (5 min) | Cap on the pre-review dependency install; on timeout the review continues without `node_modules` |
| `POSTHOG_API_KEY` | no | — | Enables PostHog AI observability. Unset = feature absent (no plugin, no download, no network) |
| `POSTHOG_HOST` | no | `https://us.i.posthog.com` | PostHog ingestion host; EU or self-hosted URL |
| `POSTHOG_PRIVACY_MODE` | no | `false` | `true` drops prompts/completions/tool IO, keeps tokens, cost, latency, model |
| `OPENCODE_CONFIG_DIR` | no | — | Path to OpenCode config (tools directory) |
| `OPENCODE_BASH_TIMEOUT_MAX_MS` | no | `120000` (2 min) | Ceiling on the `bash` timeout the model may request. Prevents the retry-with-a-larger-timeout escalation that wedges reviews |

\* Provide the private key via one of the two variables. `*_PATH` is recommended.

† Login is disabled unless `BETTER_AUTH_SECRET`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are all set.

## Dashboard settings

The dashboard (accessible at your server URL) allows setting:

- **OpenCode API key** — overrides `OPENCODE_API_KEY`
- **GLM Coding Plan API key** — overrides `ZAI_API_KEY`
- **Default model** — overrides `OPENCODE_MODEL` (reviews only; Chat uses `OPENCODE_CHAT_MODEL`)
- **Default prompt** — the base review prompt used for all repos without a custom prompt

::: warning Chat needs an OpenAI-compatible model
The opencode-go gateway is not uniformly OpenAI-shaped: each model declares which SDK it needs, and a few use the Anthropic API shape.

Reviews are unaffected — they run through the opencode server, which selects the right adapter itself. **Chat talks to the gateway directly** via `@ai-sdk/openai-compatible`, so a model using the Anthropic shape will review fine and fail in Chat with an unhelpful upstream error.

If Chat breaks after a model change, that is the first thing to check.
:::

## Using the GLM Coding Plan

Reviews run through whichever provider the model spec names, so pointing fouine at
Z.ai's [GLM Coding Plan](https://z.ai/subscribe) is two settings:

1. Set the **GLM Coding Plan API key** (or `ZAI_API_KEY`) to your Z.ai key.
2. Set the model to `zai-coding-plan/glm-5.2` — as the default model, the improver
   model, or a per-repo override. The model fields autocomplete, and once the key
   is saved the plan's models appear in the list.

The autocomplete only suggests models from providers you have a key for. Use the
**Show all providers** toggle under the field to browse the full models.dev
catalog — handy for pre-filling a model before adding its key.

The GLM key is only sent to `zai-coding-plan/*` models; everything else keeps using
`OPENCODE_API_KEY`, so you can run the reviewer on one provider and the improver on
the other. **Test connection** on the settings page only exercises the *default*
review model, so it won't verify the GLM key if you use it only for the improver
model or a per-repo override.

## Per-repo settings

Each registered repo can have:

- **Custom prompt** — overrides the default prompt for that repo
- **Custom model** — overrides the default model for that repo
- **Enabled/disabled** — toggle reviews without removing the repo

## Dashboard login

The dashboard uses **GitHub OAuth**, reusing the **same GitHub App** you already configured for webhooks — no separate OAuth App. It is enabled once `BETTER_AUTH_SECRET`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` are all set; leave any empty for local dev with no login.

In your GitHub App's settings:

1. **General → Client ID**: copy it into `GITHUB_APP_CLIENT_ID`. Generate a client secret → `GITHUB_APP_CLIENT_SECRET`.
2. **General → Callback URL**: add `${BETTER_AUTH_URL}/api/auth/callback/github`.
3. **Permissions → Account permissions → Email addresses: Read-only**. Required — GitHub Apps derive OAuth email from permissions (not scopes), and login needs an email.
4. List who may sign in in `ALLOWED_GITHUB_USERS` (comma-separated GitHub usernames). Anyone not listed is rejected on first sign-in — required, since the app is otherwise open to any GitHub account.

When enabled, `/api` requires a session. The webhook endpoint (`/webhook/github`) and `/health` are always exempt, and the login page itself is public.

On **Coolify**, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are auto-generated by the magic vars in `compose.coolify.yml` (`SERVICE_BASE64_64_FOUINE` / `SERVICE_URL_FOUINE`) — you only set `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `ALLOWED_GITHUB_USERS`. Use the app's Coolify domain for the OAuth callback.

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
