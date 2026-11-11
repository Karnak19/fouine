import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { runStatsQuery } from "~/chat/query";
import { buildChart } from "~/chat/chart";

/**
 * The chat agent's tools, ported to Mastra.
 *
 * Names (`query_stats`, `render_chart`), descriptions and zod schemas are the
 * SAME as the AI SDK originals in `~/chat/index.ts`: the browser registers its
 * tool renderers by name and reads the same fields out of the call. Only the
 * wiring changed.
 *
 * Guarding and execution stay in `~/chat/query.ts` / `~/chat/chart.ts` — the
 * SQL guard, readonly worker, row cap and deadline are not reimplemented here.
 */

export const queryStatsTool = createTool({
  id: "query_stats",
  description:
    "Run one read-only SQL SELECT against fouine's review database and get the rows back as JSON. " +
    "This is the ONLY way to answer questions about reviews, findings, cost, latency or repositories — " +
    "never answer from memory or guess at numbers. Prefer aggregating in SQL (COUNT, SUM, AVG, GROUP BY). " +
    "If a query is rejected or errors, read the message and try a corrected query.",
  inputSchema: z.object({
    sql: z
      .string()
      .describe("A single SQLite SELECT (or WITH ... SELECT) statement, no trailing semicolon needed."),
  }),
  outputSchema: z.string(),
  execute: async ({ sql }, { abortSignal }) => {
    const out = await runStatsQuery(sql, abortSignal);
    return out.ok ? `${out.rowCount} row(s) in ${out.ms}ms\n${out.text}` : out.text;
  },
});

/**
 * Draw a chart. Runs its OWN SQL rather than reusing the last `query_stats`
 * result: a tool cannot see another tool's output, and threading rows through
 * the model would mean the model retyping them — the one way numbers get
 * invented. The cost is a second query; the gain is that what is drawn came
 * straight out of the database.
 *
 * Returns a structured object, not a string, because the frontend tool card
 * needs the rows and the spec to draw. `z.unknown()` keeps that object intact:
 * the shape is `ChartResult` (ok true/false) and the client already narrows it.
 */
export const renderChartInputSchema = z.object({
  sql: z
    .string()
    .describe("A single SQLite SELECT (or WITH ... SELECT) statement, no trailing semicolon needed."),
  type: z.enum(["line", "bar", "stacked_bar"]).describe("The chart form."),
  title: z.string().describe("A short title stating what the chart shows."),
  x: z.string().describe("Name of the result column for the category or time axis."),
  y: z.string().describe("Name of the result column holding the numeric measure."),
  series: z
    .string()
    .optional()
    .describe("Name of the result column that splits the data into series. Required for stacked_bar."),
});

export const renderChartTool = createTool({
  id: "render_chart",
  description:
    "Run one read-only SQL SELECT and render the result as a chart in the answer. " +
    "Use this when the SHAPE of the data is the answer — a trend over time, a ranking, a composition — " +
    "not when the answer is a single number. `line` for change over time, `bar` for magnitude or ranking, " +
    "`stacked_bar` for composition (needs `series`). The SQL must return one column for the x axis, " +
    "one numeric column for the measure, and optionally one to split into series. " +
    "Quote your numbers from THIS tool's rows, not from a separate query_stats call, so the prose and the chart agree. " +
    "If it returns an error, read it — it lists the columns your query actually returned — and retry once.",
  inputSchema: renderChartInputSchema,
  outputSchema: z.unknown(),
  execute: async (input, { abortSignal }) => buildChart(input, abortSignal),
});
