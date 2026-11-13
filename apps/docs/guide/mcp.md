# MCP server

fouine ships a read-only [MCP](https://modelcontextprotocol.io) server. Connect Claude Code or OpenCode to it and you can ask about reviews, findings, cost and repos from your editor.

This guide connects a client. For why it is built this way, see [Two agent runtimes](/architecture/#two-agent-runtimes).

## What it can and cannot do

The tools:

| Tool | What it does |
|---|---|
| `query_stats` | Runs a read-only SQL `SELECT` against fouine's database |
| `render_chart` | Same, but returns the result as a chart |
| `list_repos` | Lists the repos fouine watches |
| `ask_chat` | Asks the dashboard's chat agent a question in plain language (max 4000 characters) |

Nothing here can start, retry or stop a review, post a comment, merge, or change a setting. There is no tool for it. A client that asks for one gets `Unknown tool`. Those actions stay in the dashboard and in GitHub comments.

## Before you start

MCP is always behind login, because it spends your model key. It needs dashboard login to be set up: `BETTER_AUTH_SECRET`, `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`, with your GitHub username in `ALLOWED_GITHUB_USERS`. See [Dashboard login](/guide/configuration#dashboard-login).

Without login, `/api/mcp` stays closed and answers `401` with a message saying why. This is on purpose.

`BETTER_AUTH_URL` must be the public address of your fouine, since the OAuth metadata is built from it.

The endpoint is `https://<your-fouine-host>/api/mcp`.

## Connect Claude Code

```bash
claude mcp add --transport http fouine https://<your-fouine-host>/api/mcp
```

Then run `/mcp` inside Claude Code and choose fouine to sign in. A browser window opens for GitHub login. Once you are signed in, the tools show up.

## Connect OpenCode

Add a remote server to your `opencode.json`:

```json
{
  "mcp": {
    "fouine": {
      "type": "remote",
      "url": "https://<your-fouine-host>/api/mcp"
    }
  }
}
```

OpenCode handles the OAuth sign-in for remote servers.

## How sign-in works

fouine acts as an OAuth server for MCP clients, using better-auth. The client finds the details at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, registers itself, and sends you to GitHub to log in. It then calls `/api/mcp` with a bearer token. A browser session cookie is not accepted on `/api/mcp`. See the [API reference](/api/#mcp-server) for the paths.

## Subscribing to `review.completed`

The server can push a `review.completed` event when a PR review finishes. The payload has `repo`, `pr`, `blocking` (how many blocking findings) and `url` (the PR). You can filter by `repo` and `pr` when you subscribe.

Things to know:

- It fires only for real PR reviews. Improver, refiner and implementer runs never emit it.
- It is experimental, built on a draft of the MCP spec. Only newer clients that support MCP events can subscribe. Claude Code and OpenCode connect with the older handshake, so the tools work for them but they do not get the events yet.
- Delivery is in memory, on one fouine process. A client that is not connected when a review ends does not get it replayed.

If you want a message when a review ends, use [Slack or Discord notifications](/guide/channels#review-done-notifications) instead.
