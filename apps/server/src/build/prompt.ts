import { yamlPrompt } from "@json-render/yaml";
import { buildCatalog, MAX_DATASETS, MAX_SPEC_NODES, type BuildDataset } from "@fouine/shared/build-catalog";
import { SCHEMA_DOC } from "~/chat/prompt";

/**
 * The two system prompts behind /build, one per step.
 *
 * The split is the point. The DATA step sees the database schema and no
 * catalog; the LAYOUT step sees the catalog and the dataset column names, and
 * never a single row. Neither step can do the other's job, which is what keeps
 * a model from writing a number it read into a layout it composed.
 */

export const DATA_SYSTEM_PROMPT = `You are building a dashboard about fouine's review history. This is the FIRST of two steps: you fetch the data now, and lay it out afterwards.

Call \`add_dataset\` once for each thing the dashboard should show — at most ${MAX_DATASETS} times. Nothing else. Do not write prose, do not describe the dashboard, do not apologise; the only useful output of this step is datasets.

## How to choose datasets

- A dashboard usually wants two or three headline numbers (\`shape: "value"\`, SQL returning exactly ONE row), one or two charts, and at most one table.
- Aggregate in SQL. \`GROUP BY\` and \`LIMIT\` in the query, not afterwards — you never see the rows, so you cannot fix them later.
- One dataset per question. Do not fetch a wide table and plan to slice it: a chart reads one dataset whole.
- Name each key for what it holds: \`cost_by_day\`, \`top_prs\`, \`totals\`.
- Order deliberately. Charts and tables keep your \`ORDER BY\`, and the row cap cuts from the end.
- If a query comes back empty or is rejected, read the message and either fix it or move on. An empty dataset is worse than no dataset.

You will NOT be shown the rows — only the column names and a count. That is deliberate: the layout references datasets by key, so you never need a value and must never state one.

${SCHEMA_DOC}`;

/**
 * The layout step's prompt: the catalog's own generated instructions, plus the
 * rules that catalog cannot express.
 */
export function layoutSystemPrompt(): string {
  return yamlPrompt(buildCatalog, {
    mode: "standalone",
    editModes: [],
    customRules: [
      "NEVER write a number or a row from the database into any prop. Charts, tables and stat tiles name a dataset with `data:` and a column by name; the dashboard looks the values up itself. A figure you type is a figure you invented.",
      "Only reference dataset keys listed in the user message. A key that was not fetched renders as an empty panel.",
      "Do NOT use `state`, `repeat`, `$state`, `$bindState`, `$item` or actions. This page is read-only and its data does not live in the state model.",
      `Keep the whole layout under ${MAX_SPEC_NODES} elements. Past that it is cut.`,
      "Root the page in a Stack. Lead with a Text heading, then a Grid of StatTiles if there are single-value datasets, then the charts, then any table.",
      "Every dataset that came back should appear somewhere on the page.",
      "Text is prose only — a title or a sentence of context. It must never carry a figure.",
    ],
  });
}

/**
 * What the layout step is told about the data: keys, titles and COLUMNS. The
 * rows stay on this server and go straight to the browser.
 */
export function datasetBriefing(datasets: BuildDataset[]): string {
  if (datasets.length === 0) {
    return "No datasets came back — every query failed or was empty. Render a single Note explaining that there is nothing to show.";
  }
  const lines = datasets.map(
    (d) =>
      `- \`${d.key}\` — ${d.title}. Columns: ${d.columns.join(", ")}. ${d.rowCount} row(s).` +
      (d.note ? ` (${d.note})` : ""),
  );
  return `Datasets available (reference them by key, never by value):\n${lines.join("\n")}`;
}
