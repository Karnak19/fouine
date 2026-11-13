# Chat and /build

Two dashboard pages let you ask questions about your own review history instead of writing SQL. Both run on [Mastra](/architecture/#two-agent-runtimes), not on the OpenCode server that does the reviews.

## Chat

The **Chat** page answers questions like "what did reviews cost last week?" or "which repo gets the most blocking findings?".

The model has two tools, and both run a read-only SQL `SELECT` against fouine's own database: one returns rows, one draws a chart. Every number in an answer comes from a query, not from the model's memory. It runs at most 6 steps per question.

It cannot see your code, call GitHub, start a review or change a setting. It cannot read the `settings` table either, so keys stay out of reach.

The conversation lives in your browser. Nothing is stored on the server, and the model only sees what you typed, not its own earlier answers. It re-queries instead. Limits per request: 40 messages, 4000 characters per message.

## /build

The **Build** page composes a whole dashboard from one sentence, such as "cost per repo by day, plus the five most expensive PRs".

It works in two steps. First the model fetches data with SQL. Then a second call lays the dashboard out, and it only sees the column names, never the rows. That keeps the model from writing a number into a layout by hand. You can keep refining the result with follow-up prompts.

## Choosing the model

Chat and `/build` use the **Chat model**, which is separate from the review model because it is a cheap, high-volume job. fouine picks it in this order:

1. the **Chat model** setting in the dashboard
2. `OPENCODE_CHAT_MODEL`
3. the built-in default, `opencode-go/deepseek-v4.1-flash`

The model must be OpenAI-compatible, because fouine calls it directly and not through OpenCode. See the warning on the [configuration page](/guide/configuration#dashboard-settings). The same model also serves the [MCP server](/guide/mcp) and the [Slack and Discord](/guide/channels) agents.

The dashboard needs a provider key (`OPENCODE_API_KEY` or the dashboard setting) for either page to work.

## Working on it without an API key

If you are developing fouine, start the server with `CHAT_MOCK=1`:

```bash
CHAT_MOCK=1 bun run dev
```

A scripted model replaces the real one. It streams some reasoning, makes a real query against your local database, and then writes a long markdown answer. Everything else is the real pipeline. The flag is ignored when `NODE_ENV=production`.

For the HTTP shape of both endpoints, see the [API reference](/api/#chat).
