import { test, expect } from "bun:test";
import { shouldAutoRetry } from "~/review/runner";

// The one-retry policy in isolation — the runner wires the real inputs
// (promise rejection, AbortController, activeReviews map) around this.

test("shouldAutoRetry: a plain failure on attempt 0 retries", () => {
  expect(shouldAutoRetry({ failed: true, aborted: false, attempt: 0, activeForKey: false })).toBe(
    true,
  );
});

test("shouldAutoRetry: an aborted run (user stop or supersession) never retries", () => {
  expect(shouldAutoRetry({ failed: true, aborted: true, attempt: 0, activeForKey: false })).toBe(
    false,
  );
});

test("shouldAutoRetry: a retry (attempt 1) never retries again", () => {
  expect(shouldAutoRetry({ failed: true, aborted: false, attempt: 1, activeForKey: false })).toBe(
    false,
  );
});

test("shouldAutoRetry: stands down when another review for the same PR is active", () => {
  expect(shouldAutoRetry({ failed: true, aborted: false, attempt: 0, activeForKey: true })).toBe(
    false,
  );
});

test("shouldAutoRetry: a successful run never retries", () => {
  expect(shouldAutoRetry({ failed: false, aborted: false, attempt: 0, activeForKey: false })).toBe(
    false,
  );
});
