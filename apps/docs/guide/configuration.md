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
| `COMMANDCODE_API_KEY` | no | — | [Command Code](https://commandcode.ai) key, used for `commandcode/*` models |
| `OPENCODE_MODEL` | no | `opencode-go/deepseek-v4-flash` | Default model for reviews |
| `OPENCODE_CHAT_MODEL` | no | `opencode-go/deepseek-v4.1-flash` | Model for Chat and `/build`. Overridden by the dashboard's **Chat** model setting; independent of the review default, since Chat is a cheap high-volume workload |
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
- **Command Code API key** — overrides `COMMANDCODE_API_KEY`
- **Default model** — overrides `OPENCODE_MODEL` (reviews only)
- **Chat model** — overrides `OPENCODE_CHAT_MODEL` for Chat and `/build`; empty falls back to the env var, then the repo default
- **Default prompt** — the base review prompt used for all repos without a custom prompt
- **Auto-merge** — on/off, default off. See the [merger guide](/guide/merger).
- **Merge method** — `merge` / `squash` / `rebase`, default `squash`. See the [merger guide](/guide/merger).
- **Refiner marks issues ready** — on/off, default off. Global default for the per-repo "Mark issues ready itself" switch; see [Per-repo settings](#per-repo-settings) below.

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

## Using Command Code

[Command Code](https://commandcode.ai) is an OpenAI-compatible gateway that
models.dev does not list, so fouine declares the provider to opencode itself and
ships a short built-in model list. Same two settings as the GLM plan:

1. Set the **Command Code API key** (or `COMMANDCODE_API_KEY`) to your key. Only
   the Pro and GOAT plans include API access; lower plans have no key to use here.
2. Set the model to one of `commandcode/zai-org/GLM-5.2`,
   `commandcode/deepseek/deepseek-v4-flash` or `commandcode/moonshotai/Kimi-K2.7-code`
   — as the default model, an agent model, or a per-repo override. Note the model
   id itself contains a slash; the spec is `commandcode/<model id>` as Command
   Code names it.

The Command Code key is only sent to `commandcode/*` models. Because the catalog
is built in rather than fetched, a model Command Code adds later won't show up in
the picker until fouine's list is updated.

## Per-repo settings

Each registered repo can have:

- **Custom prompt** — overrides the default prompt for that repo
- **Custom model** — overrides the default model for that repo
- **Enabled/disabled** — toggle reviews without removing the repo
- **Auto-merge** and **merge method** — inherit the global setting, or override per repo. See the [merger guide](/guide/merger).
- **Refine model** and **implement model** — the refiner and the implementer can each have their own model override for that repo, falling back to the repo's review model override, then the global default.
- **Mark issues ready itself** (`auto_ready`) — on/off, or unset to inherit the global default. Under "Advanced" on the repo page. When on, the refiner decides on its own whether an issue is clear enough to implement, and if so adds the repo's implement label (`fouine-ready` by default) right after posting its refinement comment. If something is still unclear, the comment lists it under "Blocking questions" and no label is added. It won't label an issue it thinks is harmful or out of scope for the repo, it says so in the comment instead.

  When a human replies on an issue that already has a refinement comment but no ready label, fouine runs another refinement round on the thread and answers only what's still open (bot comments and `/fouine` commands don't trigger this). This can happen up to 3 times; past that, fouine posts one comment asking a human to add the label, or to comment `/fouine refine` to force one more round. A human can add the label directly at any point, with or without this flag. Turning `auto_ready` on without `implement_enabled` just gets issues labelled, nothing gets implemented.

The repo page shows an **automation level**, derived from the repo's five
flags (`enabled`, `auto_merge`, `refine_enabled`, `implement_enabled`,
`auto_ready`) — there is no stored mode, just the flags:

- **Off** — all five flags off. Nothing runs automatically; slash commands still work.
- **Review** — `enabled` on, the rest off. Reviews PRs, never merges, never touches issues.
- **Review + merge** — `enabled` and `auto_merge` on. Reviews and merges PRs once approved and CI is green.
- **Autonomous** — all five flags on. Reviews and merges PRs, refines new issues, marks them ready itself, and implements them, so nothing needs a human between opening the issue and approving the PR.

**Custom** shows up when a repo's flags don't match any of the above — set the
individual switches under "Advanced" on the repo page.

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
