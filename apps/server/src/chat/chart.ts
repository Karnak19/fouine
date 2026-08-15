import { runStatsQuery, MAX_ROWS } from "~/chat/query";

/**
 * The chart tool's own SQL path — deliberately the SAME path as `query_stats`.
 *
 * Everything here goes through `runStatsQuery`, which carries the guard, the
 * readonly worker connection, the row cap and the deadline. Issue #77 is
 * explicit that the readonly connection, not the regex prefilter, is the real
 * boundary; opening a second route to the database would quietly move that
 * boundary. So this file never touches sqlite itself — it asks the same
 * function and then shapes what comes back.
 */

export type ChartType = "line" | "bar" | "stacked_bar";

export interface ChartInput {
  sql: string;
  type: ChartType;
  title: string;
  x: string;
  y: string;
  series?: string;
}

export type ChartRow = Record<string, string | number | null>;

export type ChartResult =
  | {
      ok: true;
      spec: { type: ChartType; title: string; x: string; y: string; series?: string };
      rows: ChartRow[];
      rowCount: number;
      ms: number;
      note?: string;
    }
  | { ok: false; error: string };

/**
 * How many CATEGORIES (distinct x values) a chart may plot.
 *
 * `MAX_ROWS` is 500, which is a fine answer to read as JSON and a terrible one
 * to draw: 500 bars on a dashboard-width canvas is a grey smear with no
 * readable labels. Bars carry a text label each, so they run out of room first
 * (~60 is already a dense chart); a line has no per-point label and stays
 * legible far longer, so it gets the whole 180 a quarter of a year of daily
 * buckets needs.
 *
 * The cut is by distinct x, not by row — with a `series` column one category is
 * several rows, and cutting mid-category would draw a bar that is missing a
 * slice and silently understates it.
 */
export const MAX_CATEGORIES: Record<ChartType, number> = {
  line: 180,
  bar: 60,
  stacked_bar: 60,
};

/**
 * Pull the rows back out of `runStatsQuery`.
 *
 * Its `text` is `JSON.stringify(rows)` and then, sometimes, a truncation or cap
 * note appended after a newline. `JSON.stringify` of an array never emits a raw
 * newline (they are escaped inside strings), so the first line is always the
 * whole JSON and everything after it is the note. Splitting on the first
 * newline is therefore exact, not a guess — and it keeps `runStatsQuery`'s
 * signature untouched for its existing caller.
 */
function parseRows(text: string): { rows: ChartRow[]; note?: string } | { error: string } {
  const nl = text.indexOf("\n");
  const json = nl === -1 ? text : text.slice(0, nl);
  const note = nl === -1 ? undefined : text.slice(nl + 1).trim() || undefined;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return { error: "the query did not return a row set" };
    return { rows: parsed as ChartRow[], note };
  } catch {
    return { error: "could not read the query result" };
  }
}

/** The columns actually present, taken from the first row. */
function columnsOf(rows: ChartRow[]): string[] {
  return Object.keys(rows[0] ?? {});
}

function missing(name: string, role: string, cols: string[]): string {
  return `column "${name}" (used as ${role}) is not in the result. Available columns: ${cols
    .map((c) => `"${c}"`)
    .join(", ")}. Alias the column in your SELECT, or point ${role} at one of these.`;
}

/**
 * Run the chart's SQL and validate that the result can actually be drawn.
 *
 * Every failure comes back as `{ ok: false, error }` rather than thrown, so the
 * model reads the message and retries — same contract as `query_stats`, where a
 * rejected query is a normal step and not a broken request.
 */
export async function buildChart(input: ChartInput, signal?: AbortSignal): Promise<ChartResult> {
  const { sql, type, title, x, y, series } = input;

  // Checked before the query runs: no point paying for SQL that cannot be drawn
  // whatever it returns.
  if (type === "stacked_bar" && !series) {
    return {
      ok: false,
      error:
        "stacked_bar needs a `series` column — the thing the bar is composed OF. Pass one, or use `bar` for a plain ranking.",
    };
  }

  const out = await runStatsQuery(sql, signal);
  // Guard rejection, SQL error, timeout and abort all arrive here as ok:false
  // with the message already written for a model to act on.
  if (!out.ok) return { ok: false, error: out.text };

  const parsed = parseRows(out.text);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  let { rows } = parsed;
  const notes: string[] = [];
  if (parsed.note) notes.push(parsed.note.replace(/^\(|\)$/g, ""));

  if (rows.length === 0) {
    return {
      ok: false,
      error: "the query returned no rows — there is nothing to plot. Widen the window or relax the filter.",
    };
  }

  const cols = columnsOf(rows);
  if (!cols.includes(x)) return { ok: false, error: missing(x, "x", cols) };
  if (!cols.includes(y)) return { ok: false, error: missing(y, "y", cols) };
  if (series && !cols.includes(series)) {
    return { ok: false, error: missing(series, "series", cols) };
  }

  // A chart's measure has to be a number. SQLite hands back numbers for numeric
  // columns, so a string here means the SELECT is shaping labels rather than
  // measuring something — worth saying plainly instead of drawing a flat chart.
  const bad = rows.find((r) => r[y] !== null && typeof r[y] !== "number");
  if (bad) {
    return {
      ok: false,
      error: `column "${y}" must be numeric to plot, but it holds ${JSON.stringify(bad[y])}. Aggregate it (COUNT, SUM, AVG) or use CAST(... AS REAL).`,
    };
  }
  if (rows.every((r) => r[y] === null)) {
    return { ok: false, error: `column "${y}" is NULL on every row — nothing to plot. Try COALESCE(${y}, 0).` };
  }

  // Truncate by category, keeping the FIRST ones: the model chose the ORDER BY,
  // so the head of its own ordering is the part it meant to be important.
  const cap = MAX_CATEGORIES[type];
  const categories: (string | number | null)[] = [];
  for (const r of rows) if (!categories.includes(r[x])) categories.push(r[x]);
  if (categories.length > cap) {
    const kept = new Set(categories.slice(0, cap));
    rows = rows.filter((r) => kept.has(r[x]));
    notes.push(
      `showing the first ${cap} of ${categories.length} categories — the chart is partial; aggregate further in SQL for a complete picture`,
    );
  } else if (rows.length === MAX_ROWS) {
    notes.push(`the query itself was capped at ${MAX_ROWS} rows`);
  }

  return {
    ok: true,
    spec: { type, title, x, y, ...(series ? { series } : {}) },
    rows,
    rowCount: rows.length,
    ms: out.ms ?? 0,
    ...(notes.length ? { note: notes.join("; ") } : {}),
  };
}
