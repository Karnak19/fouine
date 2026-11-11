import { MCPServer, defineEvent } from "@mastra/mcp";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { UIMessage } from "ai";
import { boundChatMessages } from "~/chat";
import { chatAgent, chatRequestContext } from "./chat";
import { listReposTool } from "./list-repos";
import { queryStatsTool, renderChartTool } from "./tools";

/**
 * `ask_chat` — the chat agent over MCP.
 *
 * Mastra can auto-expose an agent passed in `agents`, as `ask_<key>`, but that
 * path takes a bare `message` and passes it straight to `agent.generate`, with
 * no bound on size and no session for the upstream model. Defining the tool
 * ourselves keeps the SAME `MAX_TURNS` / `MAX_QUESTION_CHARS` /
 * `MAX_PARTS_PER_MESSAGE` budget as the dashboard route (via
 * `boundChatMessages`) and gives the run its own x-opencode-session.
 */
export const askChatTool = createTool({
  id: "ask_chat",
  description:
    "Ask fouine's chat agent a question about this instance's reviews, findings, cost, latency or repos. " +
    "The agent answers from SQL, never from memory, and can only read: it cannot start a review, post a " +
    "comment, merge, or change a setting. The question is capped at 4000 characters.",
  inputSchema: z.object({
    message: z
      .string()
      .describe("A single question, in plain language. Include the repo or PR number when you have one."),
  }),
  outputSchema: z.string(),
  execute: async ({ message }, { abortSignal }) => {
    // Same sanitising + limits the browser route applies, so an MCP turn can
    // never be larger than a dashboard one.
    const messages: UIMessage[] = boundChatMessages([
      { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: message }] },
    ]);
    const result = await chatAgent.generate(messages, {
      // One MCP call is one conversation: no cross-client memory, and a fresh
      // session header for the upstream gateway.
      requestContext: chatRequestContext(crypto.randomUUID()),
      abortSignal,
      // Same budget as `streamChatViaAgent`.
      maxSteps: 6,
    });
    return result.text;
  },
});

/**
 * `review.completed` — pushed to connected MCP clients when a review settles.
 *
 * @experimental SEP-3415 is a draft; the API can change under us. Emission is
 * isolated in `./review-events.ts` and fire-and-forget so a client-side or
 * protocol failure can never fail a review.
 */
export const reviewCompletedEvent = defineEvent({
  description: "A fouine review finished and its findings were posted to the pull request.",
  inputSchema: z.object({
    repo: z.string().optional().describe("Only events for this repository, e.g. acme/web."),
    pr: z.number().optional().describe("Only events for this pull request number."),
  }),
  payloadSchema: z.object({
    repo: z.string(),
    pr: z.number(),
    /** How many findings carried severity `blocking`. */
    blocking: z.number(),
    url: z.string(),
  }),
  // Subscription arguments are matched server-side; a client that passes no
  // arguments gets every repo, the same as the dashboard's global authz.
  match: (args, data) =>
    (!args.repo || args.repo === data.repo) && (args.pr === undefined || args.pr === data.pr),
});

/**
 * The one MCP server for the process lifetime, mounted at `/api/mcp`.
 *
 * Read-only by design (#175): the registry has no tool that can start a review,
 * post, merge or change a setting. A client asking for one (e.g. `start_review`)
 * gets the protocol's `Unknown tool: ...` plus the instructions below — there is
 * deliberately no mutating tool to refuse with.
 *
 * `legacy: "stateless"` is required for the 2025-era handshake Claude Code and
 * OpenCode use today; without it they get the unsupported-protocol-version
 * error. Those clients do not get the events extension (2026-07-28 only) —
 * events are experimental and new clients only.
 */
export const fouineMcp = new MCPServer({
  id: "fouine",
  name: "fouine",
  version: "1.0.0",
  instructions:
    "fouine is a self-hosted AI code reviewer. This MCP server is READ-ONLY: it can answer questions about " +
    "reviews, findings, cost and repositories, and list the repos fouine watches. It cannot start, retry or " +
    "stop a review, post or edit a comment, merge a pull request, or change any setting — asking for one of " +
    "those will return `Unknown tool`. Those actions live in the fouine dashboard and in GitHub comments.",
  tools: {
    query_stats: queryStatsTool,
    render_chart: renderChartTool,
    list_repos: listReposTool,
    ask_chat: askChatTool,
  },
  events: { "review.completed": reviewCompletedEvent },
  legacy: "stateless",
});
