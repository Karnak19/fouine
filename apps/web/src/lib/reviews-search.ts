import { RANGES, STATUSES } from "./stats-search";

// The list can also show skipped runs (the server's /reviews schema accepts it);
// stats keeps the four outcome statuses only.
export const REVIEW_STATUSES = [...STATUSES, "skipped"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
import type { StatsRange } from "./api";

// Reviews' search-param schema and validator — same shapes as stats-search
// (imported, not duplicated), but reviews has no default range: absent means
// "all time" here, unlike stats' 30d default.
export interface ReviewsSearch {
  status?: ReviewStatus;
  repo?: string;
  range?: StatsRange;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export function validateReviewsSearch(raw: Record<string, unknown>): ReviewsSearch {
  return {
    status: REVIEW_STATUSES.find((s) => s === raw.status),
    repo: str(raw.repo),
    range: RANGES.find((r) => r === raw.range),
  };
}
