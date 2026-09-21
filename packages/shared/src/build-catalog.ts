// The vocabulary the /build model may compose a dashboard out of, and the
// bounds on what it may compose.
//
// This file is shared on purpose. The server needs the catalog to build the
// spec-step system prompt (`yamlPrompt(buildCatalog)`); the browser needs the
// same catalog to build the render registry. Two copies would drift, and the
// drift would show up as the model emitting a component the renderer does not
// have — so the catalog lives here and `apps/web/src/build/catalog.ts`
// re-exports it as the one web-side json-render module.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: no component prop accepts rows, or a
// number that came out of the database. Charts, tables and stat tiles name a
// DATASET KEY and a column; the datasets are produced by the SQL tool and
// resolved client-side at render time. A prop that could hold a value is a prop
// the model will fill in from memory, and an invented number on a dashboard is
// indistinguishable from a real one.

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/** How many datasets one build may fetch. Each one is a query and a round trip. */
export const MAX_DATASETS = 6;

/** How many elements one spec may contain. Past this the page is not a dashboard. */
export const MAX_SPEC_NODES = 60;

/** How many rows a Table node draws. Datasets can hold up to MAX_ROWS (500). */
export const MAX_TABLE_ROWS = 50;

/** The chart forms the catalog offers, and the component that draws each. */
export const CHART_TYPES = ["BarChart", "StackedBarChart", "LineChart", "MixBar"] as const;
export type ChartComponent = (typeof CHART_TYPES)[number];

/** A dataset key: lowercase snake, so it reads as a name and not as free text. */
export const DATASET_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

export type DatasetCell = string | number | null;
export type DatasetRow = Record<string, DatasetCell>;

/** What a dataset is going to be drawn as, which is what sets its row cap. */
export type DatasetShape = "value" | "line" | "bar" | "stacked_bar" | "table";

/**
 * One dataset as it goes over the wire to the browser: the rows, the columns,
 * and the SQL that produced them (the "SQL behind this" disclosure reads this,
 * so every number on the page can be traced to one query).
 */
export interface BuildDataset {
  key: string;
  title: string;
  sql: string;
  /** Kept so a refine can re-run the query and cap it the same way. */
  shape?: DatasetShape;
  columns: string[];
  rows: DatasetRow[];
  rowCount: number;
  ms: number;
  /** A cap that was hit, said plainly. Rendered next to whatever was drawn. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Refining: what the browser hands back so the next prompt edits the page
// instead of rebuilding it
// ---------------------------------------------------------------------------

/**
 * A dataset as the browser sends it BACK on a refine: everything but the rows.
 * The server re-runs `sql` through the same guarded path it ran the first time,
 * so rows never travel up, only down. A client that sends arbitrary SQL here
 * gets exactly what a model would: the guard decides.
 */
export interface PreviousDataset {
  key: string;
  title: string;
  sql: string;
  shape?: DatasetShape;
}

/** The current dashboard, as the browser sends it alongside a follow-up prompt. */
export interface BuildPrevious {
  spec: { root: string; elements: Record<string, LooseElement> };
  datasets: PreviousDataset[];
  /** Every prompt applied so far, oldest first. Shown as chips, and to the model as history. */
  prompts: string[];
}

/** Upper bound on the serialised spec a refine may carry. Sixty nodes of YAML-ish props fit in a fraction of this. */
export const MAX_PREVIOUS_SPEC_BYTES = 64_000;

/** Upper bound on one dataset's SQL coming back from the browser. */
export const MAX_SQL_CHARS = 4_000;

/** How many prompts one dashboard may be the product of before the client must start over. */
export const MAX_PREVIOUS_PROMPTS = 20;

/** Dataset keys a spec's data-backed nodes actually reference, in element order, deduplicated. */
export function referencedDatasetKeys(spec: { elements?: Record<string, LooseElement> } | null | undefined): string[] {
  const keys: string[] = [];
  for (const el of Object.values(spec?.elements ?? {})) {
    if (!el || typeof el !== "object") continue;
    const type = typeof el.type === "string" ? el.type : "";
    if (!DATA_BACKED.includes(type)) continue;
    const d = el.props?.data;
    if (typeof d === "string" && !keys.includes(d)) keys.push(d);
  }
  return keys;
}

/** Strip a dataset down to what may travel back up: metadata and SQL, never rows. */
export function toPreviousDataset(d: BuildDataset): PreviousDataset {
  return {
    key: d.key,
    title: d.title,
    sql: d.sql,
    ...(d.shape ? { shape: d.shape } : {}),
  };
}

// A dataset reference, repeated on every data-backed component. `data` is a
// KEY, never rows — see the note at the top of the file.
const datasetKey = z
  .string()
  .describe("Key of a dataset fetched by add_dataset. Never rows, never numbers.");

export const buildCatalog = defineCatalog(schema, {
  components: {
    Grid: {
      props: z.object({
        columns: z
          .union([z.literal(1), z.literal(2), z.literal(3)])
          .describe("Columns on a wide screen. Always one column on a phone."),
      }),
      slots: ["default"],
      description:
        "Responsive grid. The usual page shape: a Grid of 2 or 3 holding StatTiles, then a Grid of 2 holding charts.",
      example: { columns: 2 },
    },
    Stack: {
      props: z.object({
        gap: z.enum(["tight", "normal", "loose"]).describe("Vertical spacing between children."),
      }),
      slots: ["default"],
      description: "Vertical stack. Use it as the page root and to group a heading with what it introduces.",
      example: { gap: "normal" },
    },
    Text: {
      props: z.object({
        content: z.string().describe("The words. Prose only — never a figure from the data."),
        variant: z.enum(["heading", "subheading", "body"]).describe("How large the text reads."),
      }),
      slots: [],
      description:
        "A heading or a paragraph. Must not state any number: numbers belong in a StatTile, a chart or a table, which read them from a dataset.",
      example: { content: "Review activity", variant: "heading" },
    },
    Note: {
      props: z.object({
        text: z.string().describe("A short caveat or explanation."),
        tone: z.enum(["info", "warning"]).describe("info for a caveat, warning for a limitation."),
      }),
      slots: [],
      description: "A small aside — a caveat about what the data does or does not cover.",
      example: { text: "Only completed reviews are counted.", tone: "info" },
    },
    StatTile: {
      props: z.object({
        label: z.string().describe("What the number is."),
        data: datasetKey,
        column: z.string().describe("Column of the dataset's FIRST row to show as the big number."),
        unit: z
          .enum(["count", "currency", "seconds", "percent"])
          .describe(
            'How to format the value. "percent" expects a ratio between 0 and 1 — write the SQL to divide, e.g. failed * 1.0 / total, not * 100.',
          ),
      }),
      slots: [],
      description:
        "A label and one big number, read from the first row of a dataset. Use a dataset whose query returns exactly one row.",
      example: { label: "Reviews", data: "totals", column: "reviews", unit: "count" },
    },
    BarChart: {
      props: z.object({
        title: z.string(),
        data: datasetKey,
        x: z.string().describe("Dataset column for the category axis."),
        y: z.string().describe("Dataset column holding the numeric measure."),
      }),
      slots: [],
      description: "Bars, one per category. For magnitude or a ranking.",
      example: { title: "Reviews per repository", data: "by_repo", x: "repo", y: "reviews" },
    },
    StackedBarChart: {
      props: z.object({
        title: z.string(),
        data: datasetKey,
        x: z.string().describe("Dataset column for the category axis."),
        y: z.string().describe("Dataset column holding the numeric measure."),
        series: z.string().describe("Dataset column that splits each bar into parts."),
      }),
      slots: [],
      description: "Bars split into parts. For composition — what a total is made of.",
      example: { title: "Reviews by status per day", data: "by_day", x: "day", y: "reviews", series: "status" },
    },
    LineChart: {
      props: z.object({
        title: z.string(),
        data: datasetKey,
        x: z.string().describe("Dataset column for the time axis, in order."),
        y: z.string().describe("Dataset column holding the numeric measure."),
      }),
      slots: [],
      description: "A line. For change over time.",
      example: { title: "Cost per day", data: "cost_by_day", x: "day", y: "cost" },
    },
    MixBar: {
      props: z.object({
        title: z.string(),
        data: datasetKey,
        label: z.string().describe("Dataset column holding each part's name."),
        value: z.string().describe("Dataset column holding each part's size."),
      }),
      slots: [],
      description: "A single horizontal bar split into proportions. For a breakdown of one whole.",
      example: { title: "Findings by severity", data: "severity", label: "severity", value: "findings" },
    },
    Table: {
      props: z.object({
        title: z.string(),
        data: datasetKey,
        columns: z
          .array(z.string())
          .describe("Dataset column NAMES to show, in order. Names only — never values."),
      }),
      slots: [],
      description:
        "A table of a dataset's rows. For a top-N list where the individual rows matter. Capped at " +
        `${MAX_TABLE_ROWS} rows.`,
      example: { title: "Most expensive PRs", data: "top_prs", columns: ["repo", "pr", "cost"] },
    },
  },
  actions: {},
});

export type BuildCatalog = typeof buildCatalog;

/** Component names the model may emit. */
export const BUILD_COMPONENTS: readonly string[] = buildCatalog.componentNames;

/** Components that name a dataset in their `data` prop. */
export const DATA_BACKED: readonly string[] = [
  "StatTile",
  "BarChart",
  "StackedBarChart",
  "LineChart",
  "MixBar",
  "Table",
];

// ---------------------------------------------------------------------------
// Sanitising what the model actually emitted
// ---------------------------------------------------------------------------

/**
 * A spec element as it arrives off the stream — deliberately loose, because the
 * whole point is that we do not trust it.
 */
export interface LooseElement {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: unknown;
  slots?: unknown;
  [k: string]: unknown;
}

export interface LooseSpec {
  root?: unknown;
  elements?: Record<string, LooseElement>;
}

export interface SanitizedSpec {
  spec: { root: string; elements: Record<string, LooseElement> };
  /** What was cut or rewritten, in words a reader of the page can act on. */
  notes: string[];
}

function placeholder(reason: string): LooseElement {
  return { type: "Note", props: { text: reason, tone: "warning" }, children: [] };
}

/**
 * Does this prop value look like it carries DATA rather than a reference?
 *
 * The one failure mode this catches: the model, having been told to name a
 * dataset, instead pastes the rows it just saw into the spec. Those numbers
 * came out of the model's transcription of a tool result, not out of SQL, and
 * they are the numbers that turn out to be wrong. Arrays of objects and bare
 * numbers on a data-backed component are both that mistake.
 */
function looksLikeEmbeddedData(component: string, key: string, value: unknown): boolean {
  if (Array.isArray(value)) {
    // Table.columns is a legitimate array — of column NAMES. Anything else in
    // an array, and any non-string entry, is data.
    if (component === "Table" && key === "columns") return value.some((v) => typeof v !== "string");
    return true;
  }
  if (value !== null && typeof value === "object") return true;
  // Grid.columns is a genuine layout number; every other number on a
  // data-backed component is a value the model typed.
  if (typeof value === "number") return DATA_BACKED.includes(component);
  return false;
}

/**
 * Make an arbitrary streamed spec safe to hand to the renderer.
 *
 * Nothing here throws and nothing returns "invalid": a dashboard that is 90%
 * right and says what the other 10% was is worth far more than a blank page
 * with an error on it. Every cut leaves a visible note behind.
 *
 * @param knownKeys dataset keys that actually came back. A chart naming
 *   something else is left alone — the RENDERER shows PanelEmpty for it, which
 *   is more legible in place than a note at the bottom.
 */
export function sanitizeSpec(input: LooseSpec | null | undefined, knownKeys?: readonly string[]): SanitizedSpec {
  const notes: string[] = [];
  const elements: Record<string, LooseElement> = {};
  const raw = (input?.elements ?? {}) as Record<string, LooseElement>;
  const keys = Object.keys(raw);

  let unknownTypes = 0;
  let stripped = 0;
  let kept = 0;

  for (const key of keys) {
    if (kept >= MAX_SPEC_NODES) break;
    const el = raw[key];
    if (!el || typeof el !== "object") {
      elements[key] = placeholder("This part of the layout did not arrive.");
      kept++;
      continue;
    }
    const type = typeof el.type === "string" ? el.type : "";
    if (!BUILD_COMPONENTS.includes(type)) {
      elements[key] = placeholder(`Unsupported component "${type || "?"}" — the rest of the page still renders.`);
      unknownTypes++;
      kept++;
      continue;
    }

    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el.props ?? {})) {
      if (looksLikeEmbeddedData(type, k, v)) {
        stripped++;
        continue;
      }
      props[k] = v;
    }
    // A data-backed node that lost its key (or never had one) cannot draw
    // anything; it becomes a note rather than an empty panel with no title.
    if (DATA_BACKED.includes(type) && typeof props.data !== "string") {
      elements[key] = placeholder(`A ${type} arrived without a dataset, so it was dropped.`);
      kept++;
      continue;
    }

    elements[key] = {
      type,
      props,
      children: Array.isArray(el.children) ? el.children.filter((c): c is string => typeof c === "string") : [],
    };
    kept++;
  }

  if (keys.length > kept) {
    notes.push(
      `The layout was cut to ${MAX_SPEC_NODES} elements — ${keys.length - kept} more were dropped. Ask for a smaller dashboard.`,
    );
  }
  if (unknownTypes > 0) {
    notes.push(`${unknownTypes} element${unknownTypes === 1 ? "" : "s"} used a component that does not exist.`);
  }
  if (stripped > 0) {
    notes.push(
      `${stripped} prop${stripped === 1 ? "" : "s"} carried values instead of a dataset reference and ${
        stripped === 1 ? "was" : "were"
      } ignored — every number on this page comes from SQL.`,
    );
  }

  // Dangling children would render as nothing at all; pointing them at a note
  // keeps the hole visible.
  for (const el of Object.values(elements)) {
    el.children = ((el.children as string[]) ?? []).filter((c) => c in elements);
  }

  let root = typeof input?.root === "string" ? input.root : "";
  if (!root || !(root in elements)) root = Object.keys(elements)[0] ?? "";

  if (knownKeys) {
    const missing = new Set<string>();
    for (const el of Object.values(elements)) {
      const d = (el.props as Record<string, unknown> | undefined)?.data;
      if (typeof d === "string" && !knownKeys.includes(d)) missing.add(d);
    }
    if (missing.size > 0) {
      notes.push(`No data came back for: ${[...missing].join(", ")}.`);
    }
  }

  return { spec: { root, elements }, notes };
}
