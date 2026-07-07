import { Data } from "effect";

// Tagged errors so each failure in the pipeline stays distinguishable in the
// error channel — a git failure and a GitHub auth failure are different types,
// not both `Error`. `op` names the operation that failed; `cause` keeps the
// original thrown value for logging.
export class GitError extends Data.TaggedError("GitError")<{
  op: string;
  cause: unknown;
}> {}

export class OpenCodeError extends Data.TaggedError("OpenCodeError")<{
  op: string;
  cause: unknown;
}> {}

export class GitHubError extends Data.TaggedError("GitHubError")<{
  op: string;
  cause: unknown;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  op: string;
  cause: unknown;
}> {}

// The union that can flow out of the review pipeline.
export type ReviewError = GitError | OpenCodeError | GitHubError | DatabaseError;

// Human-readable message for logging / DB `error` column, matching the old
// `String(err)` shape (`git ... failed (128): ...`, `opencode ... failed: ...`).
export function errorMessage(err: ReviewError): string {
  return String(err.cause);
}
