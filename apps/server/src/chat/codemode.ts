import { tool } from "ai";
import { z } from "zod";
import { CodeMode, Tool, toolError } from "@opencode-ai/codemode";
// ponytail: `effect4` is an npm alias for effect@4.0.0-beta.101 — the exact
// version @opencode-ai/codemode depends on, so bun installs ONE copy and the
// Effects/Schemas we build here are the very ones its interpreter runs. The rest
// of the server (src/effect/*) stays on effect v3 under the plain `effect` name;
// the two must never meet. Drop the alias when codemode moves to a stable v4 and
// the server follows.
import { Effect, Schema } from "effect4";
import type { CodemodeCall, CodemodeOutput } from "@fouine/shared";
import { MAX_ROWS, runStatsRows } from "~/chat/query";
import { buildChart, type ChartResult } from "~/chat/chart";

/**
 * The chat agent's ONE tool: `codemode`. The model writes a small program in a
 * restricted JavaScript subset (an acorn-based interpreter — no eval, no native
 * code, no ambient authority) and the only things it can call are the two tools
 * below. They are the same read-only, guarded SQL path the chat always had
 * (src/chat/query.ts); only the way the model reaches them changed, so it can
 * batch queries, aggregate in code and keep raw rows out of its own context.
 */

// Execution budget. The interpreter runs on the main thread (it also serves
// webhooks) but yields between steps, so the timeout interrupts even a busy
// loop — verified, see codemode.test.ts. Each query also has its own 5s
// deadline in query.ts.
export const CODEMODE_LIMITS = {
  timeoutMs: 20_000,
  maxToolCalls: 20,
  // What the model sees of the program's return value plus its logs. A guard
  // against a program that returns 500 raw rows, not a budget to design for.
  maxOutputBytes: 30_000,
} as const;

type ChartOk = Extract<ChartResult, { ok: true }>;

const sqlField = Schema.String.annotate({
  description: "A single SQLite SELECT (or WITH ... SELECT) statement, no trailing semicolon needed.",
});

const rowsJsonSchema = {
  type: "array",
  items: { type: "object", additionalProperties: true },
} as const;

/**
 * The tools tree for ONE execution. `charts` is the host-side collector: the
 * full ChartResult (rows + spec) goes to the UI through it, while the program
 * only gets a compact value back — the model never retypes rows into a chart.
 */
function buildTools(signal: AbortSignal | undefined, charts: ChartOk[]) {
  const query = Tool.make({
    description:
      "Run one read-only SQL SELECT against fouine's review database. Returns the rows as an array of objects. " +
      "Results are capped at 500 rows; aggregate in SQL (COUNT, SUM, AVG, GROUP BY) rather than pulling rows. " +
      "Fails with a message if the query is rejected or errors.",
    input: Schema.Struct({ sql: sqlField }),
    output: {
      type: "object",
      properties: {
        rows: rowsJsonSchema,
        rowCount: { type: "number" },
        note: { type: "string", description: "Present when the result was capped or truncated." },
      },
      required: ["rows", "rowCount"],
    },
    execute: ({ sql }) =>
      Effect.flatMap(
        Effect.promise(() => runStatsRows(sql, signal)),
        (out) => {
          if (!out.ok) return Effect.fail(toolError(out.error));
          const note = out.truncated
            ? "truncated: the result exceeded the byte cap — aggregate in SQL"
            : out.rows.length === MAX_ROWS
              ? `capped at ${MAX_ROWS} rows — aggregate in SQL if you need more`
              : undefined;
          return Effect.succeed({
            rows: out.rows,
            rowCount: out.rows.length,
            ...(note ? { note } : {}),
          });
        },
      ),
  });

  const renderChart = Tool.make({
    description:
      "Run one read-only SQL SELECT and draw the result as a chart in the answer. Use it when the SHAPE of the data " +
      "is the answer — a trend (`line`), a ranking (`bar`), a composition (`stacked_bar`, needs `series`). The SQL " +
      "must return one column for x, one numeric column for y, and optionally one to split into series. Returns " +
      "the rows that were plotted — quote your numbers from them. Fails with a message listing the columns your " +
      "query actually returned if x/y/series don't match.",
    input: Schema.Struct({
      sql: sqlField,
      type: Schema.Literals(["line", "bar", "stacked_bar"]).annotate({ description: "The chart form." }),
      title: Schema.String.annotate({ description: "A short title stating what the chart shows." }),
      x: Schema.String.annotate({ description: "Result column for the category or time axis." }),
      y: Schema.String.annotate({ description: "Result column holding the numeric measure." }),
      series: Schema.optionalKey(
        Schema.String.annotate({
          description: "Result column that splits the data into series. Required for stacked_bar.",
        }),
      ),
    }),
    output: {
      type: "object",
      properties: {
        rows: rowsJsonSchema,
        rowCount: { type: "number" },
        note: { type: "string", description: "Present when the chart is partial." },
      },
      required: ["rows", "rowCount"],
    },
    execute: (input) =>
      Effect.flatMap(Effect.promise(() => buildChart(input, signal)), (chart) => {
        if (!chart.ok) return Effect.fail(toolError(chart.error));
        charts.push(chart);
        return Effect.succeed({
          rows: chart.rows,
          rowCount: chart.rowCount,
          ...(chart.note ? { note: chart.note } : {}),
        });
      }),
  });

  return { stats: { query, render_chart: renderChart } };
}

/**
 * The model-facing guide. codemode 1.18.4 has no `instructions()` — only the
 * structured `catalog()` — so the prose is ours. Only two tools exist, so the
 * whole catalog is inlined and `tools.$codemode.search` is deliberately not
 * advertised.
 */
export function codemodeInstructions(): string {
  const catalog = CodeMode.make({ tools: buildTools(undefined, []) }).catalog();
  const signatures = catalog.map((t) => `// ${t.description}\n${t.signature}`).join("\n\n");
  return `Run a small JavaScript program that calls fouine's data tools and returns the result. Pass it as \`code\`.

## How programs work
- Tools live under the \`tools\` object and are async: \`const r = await tools.stats.query({ sql: "..." })\`.
- End with \`return <value>\` (or leave a final expression). Return only what you need to answer: aggregated numbers, a few rows. Never return raw 500-row result sets.
- Run independent calls together with \`await Promise.all([...])\` (at most 8 run at once). Filter, sum, sort and join results in code.
- A failing tool call throws; use try/catch if you want to recover inside the program, otherwise the program ends with an error you will see.
- \`console.log\` is captured as logs.

## Language
A restricted JavaScript subset: const/let, arrow functions, if/for/while, destructuring, spread, template strings, optional chaining, try/catch, and the usual Array/String/Object/Math/JSON/Date/Map/Set/RegExp methods. NOT available: imports, classes, generators, timers, fetch, process, eval, \`new Promise\`, and \`.then/.catch\` chaining (use await).

## Available tools (complete list)
\`\`\`ts
${signatures}
\`\`\``;
}

export interface CodemodeRun {
  output: CodemodeOutput;
}

/**
 * Run one program. Never throws for a program/tool/limit failure — those come
 * back as `ok: false`. `signal` is the request's: a Stop or a closed tab
 * interrupts the interpreter and any in-flight query.
 */
export async function runCodemode(
  code: string,
  signal?: AbortSignal,
  // Tests shorten the timeout; production always runs the defaults.
  limits: Partial<CodeMode.ExecutionLimits> = {},
): Promise<CodemodeOutput> {
  const charts: ChartOk[] = [];
  const calls: CodemodeCall[] = [];
  const runtime = CodeMode.make({
    tools: buildTools(signal, charts),
    limits: { ...CODEMODE_LIMITS, ...limits },
    onToolCallEnd: (call) =>
      Effect.sync(() => {
        calls.push({
          name: call.name,
          input: call.input,
          outcome: call.outcome,
          durationMs: call.durationMs,
          ...(call.message ? { message: call.message } : {}),
        });
      }),
  });

  let result: CodeMode.Result;
  try {
    result = await Effect.runPromise(runtime.execute(code), signal ? { signal } : undefined);
  } catch (err) {
    // Host interruption (the request was aborted) surfaces as a rejection, not
    // as a Result. Report it as a failure so the UI card ends in a clear state.
    return {
      ok: false,
      error: {
        kind: "ExecutionFailure",
        message: signal?.aborted ? "Execution was stopped." : String((err as Error)?.message ?? err),
      },
      logs: [],
      truncated: false,
      calls,
      charts,
    };
  }

  const logs = [
    ...(result.logs ?? []),
    ...(result.ok ? (result.warnings ?? []).map((w) => `warning (${w.kind}): ${w.message}`) : []),
  ];
  const base = { logs, truncated: result.truncated ?? false, calls, charts };
  return result.ok
    ? { ok: true, value: result.value, ...base }
    : { ok: false, error: { kind: result.error.kind, message: result.error.message }, ...base };
}

/**
 * The AI SDK tool. The UI gets the full output (charts included); the model
 * gets everything EXCEPT the chart payloads — it already has the plotted rows
 * if the program returned them, and re-sending every chart would only spend
 * context.
 */
export const codemodeTool = tool({
  description: codemodeInstructions(),
  inputSchema: z.object({
    code: z.string().describe("The JavaScript program to run. It can call `tools.stats.query` and `tools.stats.render_chart`."),
  }),
  execute: ({ code }, { abortSignal }) => runCodemode(code, abortSignal),
  toModelOutput: ({ output }) => {
    const { charts, calls, ...rest } = output;
    return {
      type: "json",
      // JSON round-trip: `value` holds program data typed `unknown`, the SDK wants JSONValue.
      value: JSON.parse(JSON.stringify({
        ...rest,
        toolCalls: calls.map((c) => (c.outcome === "success" ? c.name : `${c.name} (${c.outcome})`)),
        ...(charts.length
          ? {
              chartsRendered: `rendered ${charts.length} chart(s) in the answer: ${charts
                .map((c) => `"${c.spec.title}"`)
                .join(", ")}`,
            }
          : {}),
      })),
    };
  },
});
