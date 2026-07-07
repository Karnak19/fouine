import { Layer } from "effect";
import { DbService } from "~/effect/db";
import { GitHubService } from "~/effect/github";
import { GitService } from "~/effect/git";
import { OpenCodeService } from "~/effect/opencode";

// The full dependency graph the review pipeline needs. Provide this once at the
// runPromise boundary; swap individual layers in tests.
export const AppLayer = Layer.mergeAll(
  DbService.Default,
  GitHubService.Default,
  GitService.Default,
  OpenCodeService.Default,
);

export * from "~/effect/errors";
export { reviewPipeline } from "~/effect/review";
export { DbService } from "~/effect/db";
export { GitHubService } from "~/effect/github";
export { GitService } from "~/effect/git";
export { OpenCodeService } from "~/effect/opencode";
