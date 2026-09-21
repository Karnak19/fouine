import { yamlPrompt } from "@json-render/yaml";
import {
  buildCatalog,
  MAX_DATASETS,
  MAX_SPEC_NODES,
  type BuildDataset,
  type BuildPrevious,
  type PreviousDataset,
} from "@fouine/shared/build-catalog";
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
- A percentage is a RATIO between 0 and 1. Divide and stop: \`failed * 1.0 / total\`, never \`100.0 * failed / total\`. The layout step multiplies by 100 when it shows the number, so a column that already did renders a hundred times too large — and the SQL sits right under it on the page for anyone to check.
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
export function datasetBriefing(datasets: readonly BuildDataset[]): string {
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

// ---------------------------------------------------------------------------
// Refining an existing dashboard
// ---------------------------------------------------------------------------

/**
 * The data step on a refine: same schema, same tool, but told what is already
 * fetched so it only adds what the new request needs. The existing datasets
 * are re-run server-side before this step starts, so from the model's point
 * of view they simply exist; calling `add_dataset` with one of their keys is
 * refused as a duplicate.
 */
export const DATA_REFINE_PROMPT = `${DATA_SYSTEM_PROMPT}

## This is a REFINEMENT

A dashboard already exists and the user is asking for a change to it. The datasets it uses are listed in the user message with their SQL; they are already fetched and will be on the page — do NOT fetch them again and do not fetch a variation of one that is already there.

Call \`add_dataset\` ONLY for data the new request needs and none of the existing datasets provide. If the request is purely about layout (change a chart type, reorder, rename, remove a panel), call nothing at all and stop. The total number of datasets, existing plus new, stays under ${MAX_DATASETS}.`;

/** What the data step is told about the datasets that already exist: keys, titles and the SQL. No rows, no counts it could quote. */
export function existingDatasetsBriefing(datasets: readonly PreviousDataset[]): string {
  if (datasets.length === 0) return "No datasets exist yet on this dashboard.";
  const lines = datasets.map((d) => `- \`${d.key}\` — ${d.title}\n  SQL: ${d.sql.replace(/\s+/g, " ").trim()}`);
  return `Datasets already on the dashboard (do not fetch these again):\n${lines.join("\n")}`;
}

/** The user message for the data step of a refine. */
export function refineDataPrompt(question: string, previous: BuildPrevious): string {
  const history = previous.prompts.length
    ? `The dashboard so far was asked for with, in order:\n${previous.prompts.map((p) => `- ${p}`).join("\n")}\n\n`
    : "";
  return `${history}${existingDatasetsBriefing(previous.datasets)}\n\nNew request: ${question}`;
}

/**
 * The user message for the layout step of a refine: the current spec as YAML,
 * the datasets it may reference (columns and counts, never rows — the same
 * briefing as a first build) and the instruction. The model writes the WHOLE
 * edited spec back, not a diff: the wire format stays identical to a first
 * build, and a full re-emit of sixty nodes is cheap enough that json-render's
 * patch modes are left off until it proves otherwise.
 */
export function refineLayoutPrompt(
  question: string,
  previous: BuildPrevious,
  datasets: readonly BuildDataset[],
): string {
  const yaml = Bun.YAML.stringify(previous.spec, null, 2);
  const history = previous.prompts.length
    ? `It was asked for with, in order:\n${previous.prompts.map((p) => `- ${p}`).join("\n")}\n\n`
    : "";
  return (
    `You are EDITING an existing dashboard. ${history}This is its current spec:\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n` +
    `${datasetBriefing(datasets)}\n\n` +
    `Requested change: ${question}\n\n` +
    "Write the COMPLETE edited spec in one ```yaml-spec fence — every element that should remain, unchanged, plus the change. " +
    "Keep the element keys of the parts you do not touch. Do not describe the change, do not write a diff; the whole page, edited."
  );
}
