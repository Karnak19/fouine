import { findings, reviews } from "~/db";
import { log } from "~/server/log";
import { fouineMcp } from "./mcp";

// Emits `review.completed` to connected MCP clients. Kept in its own module, and
// in its own function, because MCP events are experimental (SEP-3415) and this
// is the ONLY place the review pipeline touches them: a failure here must be a
// log line, never a failed review. `DbService.complete` calls it with `void`.
// ponytail: in-process push only (the ring buffer + open `events/stream`
// subscribers); fan-out across fouine instances would need a shared bus.

type Emitter = (name: string, data: Record<string, unknown>) => Promise<unknown>;

const defaultEmitter: Emitter = (name, data) => fouineMcp.events.emit(name, data);

/**
 * Publish one review's completion, fire-and-forget.
 *
 * Never throws and never rejects: `emit` validates the payload and rejects for
 * an unknown event or a bad shape, and all of that is swallowed into a warning.
 * The emitter is injectable so the test can prove the failure path without
 * breaking schemas or reaching into Mastra.
 */
export function emitReviewCompleted(
  reviewId: number,
  emit: Emitter = defaultEmitter,
): Promise<void> {
  return (async () => {
    try {
      const row = reviews.byId.get({ $id: reviewId });
      if (!row) return;
      const blocking = findings
        .byReview.all({ $review: reviewId })
        .filter((f) => f.severity === "blocking").length;
      await emit("review.completed", {
        repo: row.repo_full_name,
        pr: row.pr_number,
        blocking,
        // We do not store a review URL: the PR is the stable, useful link.
        url: `https://github.com/${row.repo_full_name}/pull/${row.pr_number}`,
      });
    } catch (err) {
      log.warn("mcp review.completed emit failed", {
        review: reviewId,
        error: String(err),
      });
    }
  })();
}
