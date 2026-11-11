import { findings, reviews } from "~/db";
import { log } from "~/server/log";
import { notifyReviewCompleted, type ReviewNotification } from "./channels";
import { fouineMcp } from "./mcp";

// Emits `review.completed` to connected MCP clients and fans the same payload
// out to Slack/Discord. Kept in its own module, and in its own function,
// because MCP events are experimental (SEP-3415) and this is the ONLY place
// the review pipeline touches them: a failure here must be a log line, never a
// failed review. `DbService.complete` calls it with `void`.
// ponytail: in-process push only (the ring buffer + open `events/stream`
// subscribers); fan-out across fouine instances would need a shared bus.

type Emitter = (name: string, data: Record<string, unknown>) => Promise<unknown>;
type Notifier = (review: ReviewNotification) => Promise<void>;

const defaultEmitter: Emitter = (name, data) => fouineMcp.events.emit(name, data);

/**
 * Publish one review's completion, fire-and-forget.
 *
 * Never throws and never rejects: `emit` validates the payload and rejects for
 * an unknown event or a bad shape, and all of that is swallowed into a warning.
 * The emitter and notifier are injectable so tests can prove the failure paths
 * without breaking schemas or reaching into Mastra or a live channel.
 *
 * The payload is built ONE time here; MCP and the channel notification reuse
 * it, so the two cannot drift. Notification is started before the MCP emit and
 * never awaited — a slow or failing Slack/Discord post must not delay or fail a
 * review.
 */
export function emitReviewCompleted(
  reviewId: number,
  emit: Emitter = defaultEmitter,
  notify: Notifier = notifyReviewCompleted,
): Promise<void> {
  return (async () => {
    try {
      const row = reviews.byId.get({ $id: reviewId });
      if (!row) return;
      // Only PR reviews emit: `DbService.complete` is shared by all five
      // pipelines, and three are not PR reviews — improve rows carry
      // pr_number = 0 and refine/implement rows carry an ISSUE number, so the
      // payload's pr/url would lie (`/pull/0`, dead `/pull/<issue>` links) and
      // the hourly improver would spam subscribers with them.
      if (row.trigger === "improve" || row.trigger === "refine" || row.trigger === "implement") {
        return;
      }
      const blocking = findings
        .byReview.all({ $review: reviewId })
        .filter((f) => f.severity === "blocking").length;
      const payload = {
        repo: row.repo_full_name,
        pr: row.pr_number,
        blocking,
        // We do not store a review URL: the PR is the stable, useful link.
        url: `https://github.com/${row.repo_full_name}/pull/${row.pr_number}`,
      };

      // Only real PR reviews get a channel post: refine/implement/improve rows
      // carry an ISSUE number (or 0) in pr_number, so the payload's `/pull/…`
      // link would point at the wrong thing. The MCP event keeps its existing
      // shape for those rows.
      const isPrReview =
        !row.trigger || !["improve", "refine", "implement"].includes(row.trigger);
      if (isPrReview) {
        // Fire-and-forget: started, never awaited. `notifyReviewCompleted`
        // itself never rejects; the catch covers an injected notifier.
        try {
          void notify(payload).catch((err) =>
            log.warn("channel review notification failed", {
              review: reviewId,
              error: String(err),
            }),
          );
        } catch (err) {
          log.warn("channel review notification failed", {
            review: reviewId,
            error: String(err),
          });
        }
      }

      await emit("review.completed", payload);
    } catch (err) {
      log.warn("mcp review.completed emit failed", {
        review: reviewId,
        error: String(err),
      });
    }
  })();
}
