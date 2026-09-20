import { log } from "~/server/log";

// Process-level crash guards, installed first thing in index.ts.
//
// The incident this exists for (Sept 18–20, 2026): every review completion
// aborted the opencode SDK with a custom reason string, and one SDK-internal
// promise rejected with that reason ("cleanup") with no catch anywhere —
// Bun's default for an unhandled rejection is to exit the process. 62
// container restarts in two days, and every review in flight at each death
// was reaped as "Interrupted by server restart". A stray rejection after the
// fact must cost a log line, never the whole server — everything the process
// runs (reviews, refines, chat, the merger) shares its fate.
export function installProcessGuards(): void {
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection (survived)", {
      reason: String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  // A synchronous throw that escapes to the event loop leaves process state
  // undefined — log it loudly and exit into the supervisor's restart, which
  // boots into a known state (the orphan reaper cleans up after a death).
  // Not survivable like a rejection: half-run sync code can't be trusted.
  process.on("uncaughtException", (err) => {
    log.error("uncaught exception, exiting", { error: String(err), stack: err.stack });
    process.exit(1);
  });
}
