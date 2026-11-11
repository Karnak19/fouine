import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { createTool } from "@mastra/core/tools";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { buildChart } from "~/chat/chart";
import { buildChatModel } from "~/chat/model";
import { CHAT_SYSTEM_PROMPT } from "~/chat/prompt";
import { log } from "~/server/log";
import { askChatTool } from "./mcp";
import { listReposTool } from "./list-repos";
import { queryStatsTool, renderChartInputSchema } from "./tools";

// Request-context key, private to this module: the model is built once per run
// (one upstream session) even if Mastra asks the resolver again per step.
const MODEL_KEY = "fouine.channel.model";

/**
 * The channel agent (#176): the same read-only fouine answers, in Slack or
 * Discord.
 *
 * Read-only is enforced by the registry, not the prompt: the only tools below
 * can read. There is deliberately no `start_review`/`post_comment`/`merge_pr`
 * tool to reach, so a start-work request fails as an unknown tool exactly like
 * MCP (#175), whatever the model is told.
 */

const CHANNEL_ADDENDUM = `

## You are in a chat channel (Slack or Discord)

Keep answers short — a few sentences, or a small table. This is a conversation,
not the dashboard. Memory is per-thread, so earlier turns in this thread are
visible to you.

You are READ-ONLY here too. Alongside the two SQL tools you have \`list_repos\` and
\`ask_chat\`. You cannot start, retry or stop a review, post or edit a comment,
merge a pull request, or change a setting. There is no tool for those actions;
say plainly that the action lives in the fouine dashboard or in GitHub comments.

Charts cannot be drawn in Slack or Discord. \`render_chart\` still runs the SQL
and returns the plotted rows as a short text table — use it, then describe the
shape in prose rather than pretending a picture exists.`;

/**
 * `render_chart`, degraded to text for channels.
 *
 * The channel platforms cannot render the dashboard's chart spec. Rather than
 * dropping the tool (which would make channel answers weaker than MCP ones) we
 * keep the same name/schema and return the rows the chart would have plotted as
 * a compact text table. Same SQL path (`buildChart`), so the numbers are still
 * database-derived rather than retyped by the model.
 */
export const channelRenderChartTool = createTool({
  id: "render_chart",
  description:
    "Run one read-only SQL SELECT and get its result back as a short text table. Chat channels cannot draw " +
    "charts, so this is the text-only form of the dashboard's chart tool: use it when the SHAPE of the data is " +
    "the answer (a trend, a ranking, a composition), then describe that shape in prose. Same arguments as " +
    "the dashboard tool: one x column, one numeric y column, an optional series column.",
  inputSchema: renderChartInputSchema,
  outputSchema: z.string(),
  execute: async (input, { abortSignal }) => {
    const chart = await buildChart(input, abortSignal);
    if (!chart.ok) return `Chart unavailable: ${chart.error}`;
    const columns = [chart.spec.x, chart.spec.y, ...(chart.spec.series ? [chart.spec.series] : [])];
    const rows = chart.rows
      .slice(0, 20)
      .map((row) => columns.map((column) => `${column}=${String(row[column] ?? "null")}`).join(", "));
    const more =
      chart.rows.length > rows.length ? `\n… ${chart.rows.length - rows.length} more row(s)` : "";
    return (
      `${chart.spec.title} (${chart.spec.type})\n` +
      `${rows.join("\n")}${more}\n\n` +
      "Charts cannot be drawn in chat channels; this is the plotted data as text."
    );
  },
});

/**
 * Channel memory. Storage is Mastra's `${DATA_DIR}/mastra.db` (the instance
 * registers it on this agent), so a Slack thread survives a restart and each
 * thread remembers its own earlier turns.
 */
export const channelMemory = new Memory({});

export const channelAgent = new Agent({
  id: "channel",
  name: "fouine channels",
  instructions: `${CHAT_SYSTEM_PROMPT}${CHANNEL_ADDENDUM}`,
  // Same resolver as chat, so the dashboard's chat model knob (and CHAT_MOCK)
  // applies to channel turns too. Memoised on the request context: Mastra may
  // ask once per step, and one run must keep one upstream session.
  model: ({ requestContext }) => {
    const cached = requestContext.getRaw(MODEL_KEY) as MastraModelConfig | undefined;
    if (cached) return cached;
    const model = buildChatModel(crypto.randomUUID());
    log.debug("channel model resolved", {
      model:
        (model as { id?: string }).id ??
        (model as { modelId?: string }).modelId ??
        "unknown",
    });
    requestContext.setRaw(MODEL_KEY, model);
    return model;
  },
  tools: {
    query_stats: queryStatsTool,
    render_chart: channelRenderChartTool,
    list_repos: listReposTool,
    ask_chat: askChatTool,
  },
  memory: channelMemory,
});
