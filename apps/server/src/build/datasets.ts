import { tool } from "ai";
import { z } from "zod";
import { runStatsQuery, MAX_ROWS } from "~/chat/query";
import { parseRows, MAX_CATEGORIES, type ChartRow } from "~/chat/chart";
import {
  MAX_DATASETS,
  MAX_TABLE_ROWS,
  DATASET_KEY_RE,
  type BuildDataset,
} from "@fouine/shared/build-catalog";

/**
 * The data step of a /build run: the model fetches named datasets, and only
 * then composes a layout that references them by name.
 *
 * Same boundary as chat. Every query here goes through `runStatsQuery` — the
 * guard, the readonly worker, the row cap, the deadline (#77 is explicit that
 * the readonly connection is the boundary, not the regex prefilter). Nothing in
 * this file opens sqlite, and nothing relaxes the guard.
 *
 * What is different from `render_chart` is what comes BACK to the model: a key,
 * the column names and a row count — never the rows. The rows go straight to
 * the browser. A model that never sees a number cannot retype one into the
 * spec, which is the whole reason charts reference a dataset key instead of
 * carrying values.
 */

/** What the dataset is going to be drawn as, which is what sets its cap. */
export type DatasetShape = "value" | "line" | "bar" | "stacked_bar" | "table";

export interface DatasetStepResult {
  datasets: BuildDataset[];
  /** Caps hit across the step, said plainly for the page to show. */
  notes: string[];
}

function capFor(shape: DatasetShape): number {
  switch (shape) {
    case "value":
      return 1;
    case "table":
      return MAX_TABLE_ROWS;
    case "line":
      return MAX_CATEGORIES.line;
    default:
      return MAX_CATEGORIES.bar;
  }
}

/**
 * Trim a result to what its shape can actually render.
 *
 * Cut by distinct x, not by row, for the same reason `chart.ts` does: with a
 * `series` column one category is several rows, and stopping mid-category draws
 * a bar that is missing a slice and silently understates itself.
 */
function capRows(
  rows: ChartRow[],
  shape: DatasetShape,
  x: string | undefined,
): { rows: ChartRow[]; note?: string } {
  const cap = capFor(shape);
  if (shape === "value" || shape === "table" || !x) {
    if (rows.length <= cap) return { rows };
    return {
      rows: rows.slice(0, cap),
      note: `showing the first ${cap} of ${rows.length} rows`,
    };
  }
  const categories: (string | number | null)[] = [];
  for (const r of rows) if (!categories.includes(r[x])) categories.push(r[x]);
  if (categories.length <= cap) {
    // `runStatsQuery`'s LIMIT counts rows, not categories, so at MAX_ROWS it can
    // land mid-category and the last bar draws short — missing a slice and
    // quietly understating itself. We cannot tell "cut short" from "ended on a
    // boundary", so drop the last category either way, like chart.ts does:
    // losing one complete bar now and then is the cheap mistake.
    if (rows.length === MAX_ROWS && rows.length > categories.length) {
      const last = categories[categories.length - 1];
      return {
        rows: rows.filter((r) => r[x] !== last),
        note: `the query was capped at ${MAX_ROWS} rows, which may have cut the last category short, so it was dropped — aggregate further in SQL for a complete picture`,
      };
    }
    return { rows };
  }
  const kept = new Set(categories.slice(0, cap));
  return {
    rows: rows.filter((r) => kept.has(r[x])),
    note: `showing the first ${cap} of ${categories.length} categories — aggregate further in SQL for a complete picture`,
  };
}

/**
 * Build the `add_dataset` tool for one request, plus the box its results land in.
 *
 * `onDataset` fires the moment a dataset is ready, so the browser can paint the
 * page's data before the layout that arranges it exists. That ordering is the
 * point: charts arrive last and find their rows already there.
 */
export function createDatasetStep(signal?: AbortSignal, onDataset?: (d: BuildDataset) => void) {
  const datasets: BuildDataset[] = [];
  const notes: string[] = [];

  const addDataset = tool({
    description:
      "Run one read-only SQL SELECT and keep the result as a NAMED dataset the dashboard can draw. " +
      "This is the only way to get data onto the page: the layout you write afterwards references these keys, " +
      `never values. Call it once per thing you want to show, at most ${MAX_DATASETS} times. ` +
      "You get back the column names and a row count, not the rows — you do not need to see them to lay them out. " +
      "If it returns an error, read it and retry with corrected SQL.",
    inputSchema: z.object({
      key: z
        .string()
        .describe("Short snake_case name, e.g. `cost_by_day`. The layout references the dataset by this key."),
      title: z.string().describe("A short human title for this dataset, shown in the SQL disclosure."),
      sql: z.string().describe("A single SQLite SELECT (or WITH ... SELECT), no trailing semicolon."),
      shape: z
        .enum(["value", "line", "bar", "stacked_bar", "table"])
        .describe(
          "What this will be drawn as. `value` for a StatTile (write SQL returning ONE row), " +
            "`line`/`bar`/`stacked_bar` for a chart, `table` for a row list. Sets the row cap.",
        ),
      x: z
        .string()
        .optional()
        .describe("Column for the category or time axis. Required for line/bar/stacked_bar."),
      y: z.string().optional().describe("Column holding the numeric measure. Required for line/bar/stacked_bar."),
      series: z.string().optional().describe("Column that splits the data into series. Required for stacked_bar."),
    }),
    execute: async (input) => {
      const { key, title, sql, shape, x, y, series } = input;

      if (!DATASET_KEY_RE.test(key)) {
        return `Rejected: "${key}" is not a valid key — use lowercase snake_case, e.g. cost_by_day.`;
      }
      if (datasets.some((d) => d.key === key)) {
        return `Rejected: a dataset called "${key}" already exists. Pick another name or reuse that one.`;
      }
      if (datasets.length >= MAX_DATASETS) {
        // Not an error the run should die on: the model keeps what it has and
        // lays that out. The page says a cap was hit.
        notes.push(
          `This build asked for more than ${MAX_DATASETS} datasets; the extra ones were not fetched.`,
        );
        return `Rejected: the ${MAX_DATASETS}-dataset limit is reached. Lay out the datasets you already have.`;
      }
      if (shape !== "value" && shape !== "table" && (!x || !y)) {
        return `Rejected: shape "${shape}" needs both \`x\` and \`y\`.`;
      }
      if (shape === "stacked_bar" && !series) {
        return "Rejected: shape \"stacked_bar\" needs a `series` column — the thing each bar is composed OF.";
      }

      const out = await runStatsQuery(sql, signal);
      if (!out.ok) return out.text;

      const parsed = parseRows(out.text);
      if ("error" in parsed) return `Rejected: ${parsed.error}`;
      if (parsed.rows.length === 0) {
        return "The query returned no rows. Widen the window or relax the filter, or drop this dataset.";
      }

      const columns = Object.keys(parsed.rows[0] ?? {});
      for (const [role, col] of [
        ["x", x],
        ["y", y],
        ["series", series],
      ] as const) {
        if (col && !columns.includes(col)) {
          return `Rejected: column "${col}" (used as ${role}) is not in the result. Available: ${columns
            .map((c) => `"${c}"`)
            .join(", ")}.`;
        }
      }

      const capped = capRows(parsed.rows, shape, x);
      const noteParts: string[] = [];
      if (parsed.note) noteParts.push(parsed.note.replace(/^\(|\)$/g, ""));
      if (capped.note) noteParts.push(capped.note);

      const dataset: BuildDataset = {
        key,
        title,
        sql,
        columns,
        rows: capped.rows,
        rowCount: capped.rows.length,
        ms: out.ms ?? 0,
        ...(noteParts.length ? { note: noteParts.join("; ") } : {}),
      };
      datasets.push(dataset);
      onDataset?.(dataset);

      // What goes back to the model: names and counts. Never rows.
      return (
        `Dataset "${key}" ready: ${dataset.rowCount} row(s), columns ${columns.join(", ")}. ` +
        (dataset.note ? `Note: ${dataset.note}. ` : "") +
        `Reference it in the layout as data: ${key}.`
      );
    },
  });

  return {
    tool: addDataset,
    result(): DatasetStepResult {
      return { datasets, notes: [...new Set(notes)] };
    },
  };
}
