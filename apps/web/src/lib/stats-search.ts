import type { StatsRange } from "./api";

// Stats' search-param schema and validator. Lives in lib/, not stats.tsx,
// because __root.tsx needs validateSearch synchronously and a static import
// of stats.tsx would pull its charts/day-picker into the eager bundle.
export const RANGES = ["24h", "7d", "30d", "90d", "all"] as const;
export const DEFAULT_RANGE: StatsRange = "30d";
export const STATUSES = ["pending", "running", "completed", "failed"] as const;
export type Status = (typeof STATUSES)[number];

export interface StatsSearch {
  // `range` is absent from the URL when it's the default — a clean link for the
  // default view. Everything reads it through `search.range ?? DEFAULT_RANGE`.
  range?: StatsRange;
  // Custom window, YYYY-MM-DD. Either bound alone is valid. When either is set
  // it wins and `range` is ignored, so the UI can never show a custom window
  // while a preset still looks selected.
  from?: string;
  to?: string;
  repo?: string;
  model?: string;
  status?: Status;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

// Same shape of validation as the server's dayEpoch: a real UTC calendar day or
// nothing. Keeps `from=lol` out of the URL instead of round-tripping garbage.
// The NaN check is load-bearing: "2026-13-45" passes the regex, and calling
// toISOString() on the resulting Invalid Date throws a RangeError that takes
// the whole page down rather than falling back to the preset.
const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v;
};

const day = (v: unknown) => (isDay(v) ? v : undefined);

export function validateStatsSearch(raw: Record<string, unknown>): StatsSearch {
  const range = RANGES.find((r) => r === raw.range && r !== DEFAULT_RANGE);
  const status = STATUSES.find((s) => s === raw.status);
  const from = day(raw.from);
  const to = day(raw.to);
  return {
    // A custom window owns the time axis; drop range so the two can't disagree.
    range: from || to ? undefined : range,
    from,
    to,
    repo: str(raw.repo),
    model: str(raw.model),
    status,
  };
}
