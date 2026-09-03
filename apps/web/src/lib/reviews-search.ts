import { RANGES, STATUSES, type Status } from "./stats-search";
import type { StatsRange } from "./api";

// Reviews' search-param schema and validator — same shapes as stats-search
// (imported, not duplicated), but reviews has no default range: absent means
// "all time" here, unlike stats' 30d default.
export interface ReviewsSearch {
  status?: Status;
  repo?: string;
  range?: StatsRange;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export function validateReviewsSearch(raw: Record<string, unknown>): ReviewsSearch {
  return {
    status: STATUSES.find((s) => s === raw.status),
    repo: str(raw.repo),
    range: RANGES.find((r) => r === raw.range),
  };
}
