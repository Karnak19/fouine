import { test, expect } from "bun:test";
import { shouldAutoRetry } from "~/review/runner";

// The one-retry policy in isolation — the runner wires the real inputs
// (promise rejection, AbortController, newest-row ownership check) around this.

test("shouldAutoRetry: a plain failure on attempt 0 retries", () => {
  expect(shouldAutoRetry({ failed: true, aborted: false, attempt: 0, ownsPR: true })).toBe(true);
});

test("shouldAutoRetry: an aborted run (user stop or supersession) never retries", () => {
  expect(shouldAutoRetry({ failed: true, aborted: true, attempt: 0, ownsPR: true })).toBe(false);
});

test("shouldAutoRetry: a retry (attempt 1) never retries again", () => {
  expect(shouldAutoRetry({ failed: true, aborted: false, attempt: 1, ownsPR: true })).toBe(false);
});

test("shouldAutoRetry: stands down when a newer review row owns the PR", () => {
  expect(shouldAutoRetry({ failed: true, aborted: false, attempt: 0, ownsPR: false })).toBe(false);
});

test("shouldAutoRetry: a successful run never retries", () => {
  expect(shouldAutoRetry({ failed: false, aborted: false, attempt: 0, ownsPR: true })).toBe(false);
});
