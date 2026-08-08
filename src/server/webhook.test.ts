import { test, expect, afterEach } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyAndDispatch, VerificationError, triggerSkipReason } from "~/server/webhook";
import { settings, db } from "~/db";
import { SETTINGS, DEFAULT_TRIGGERS, resolveTriggers } from "~/settings";

const SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

function sign(payload: string, secret: string = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

const PING = JSON.stringify({
  zen: "Practicality beats purity.",
  hook_id: 1,
  hook: {
    id: 1,
    name: "web",
    active: true,
    events: ["pull_request"],
    config: { url: "https://example.com/webhook", content_type: "json" },
  },
});

test("rejects a missing signature", async () => {
  await expect(
    verifyAndDispatch({ id: "1", name: "ping", payload: PING, signature: null }),
  ).rejects.toBeInstanceOf(VerificationError);
});

test("rejects a bad signature", async () => {
  await expect(
    verifyAndDispatch({
      id: "1",
      name: "ping",
      payload: PING,
      signature: "sha256=deadbeef",
    }),
  ).rejects.toBeInstanceOf(VerificationError);
});

test("rejects a signature signed with the wrong secret", async () => {
  await expect(
    verifyAndDispatch({
      id: "1",
      name: "ping",
      payload: PING,
      signature: sign(PING, "wrong-secret"),
    }),
  ).rejects.toBeInstanceOf(VerificationError);
});

test("accepts a valid GitHub-style signature", async () => {
  await expect(
    verifyAndDispatch({
      id: "1",
      name: "ping",
      payload: PING,
      signature: sign(PING),
    }),
  ).resolves.toBeUndefined();
});

// --- Trigger rules -----------------------------------------------------------

const setGlobal = (value: string) =>
  settings.set.run({ $key: SETTINGS.TRIGGERS, $value: value });
const clearGlobal = () => db.exec(`DELETE FROM settings WHERE key = '${SETTINGS.TRIGGERS}'`);

afterEach(clearGlobal);

test("a fresh install (no global row, no repo override) gets the defaults", () => {
  expect(resolveTriggers(null)).toEqual(DEFAULT_TRIGGERS);
  expect(triggerSkipReason(null, "opened", false)).toBeNull();
  expect(triggerSkipReason(null, "synchronize", false)).toBeNull();
  expect(triggerSkipReason(null, "reopened", false)).toBeNull();
  expect(triggerSkipReason(null, "labeled", false)).toBe("action not handled");
});

// The bug this whole feature came out of: `gh stack submit` opens PRs as drafts.
test("a PR opened as a draft is skipped, then reviewed when marked ready", () => {
  expect(triggerSkipReason(null, "opened", true)).toBe("draft PR");
  // GitHub clears `draft` on the ready_for_review delivery.
  expect(triggerSkipReason(null, "ready_for_review", false)).toBeNull();
});

test("reviewDrafts on reviews the draft immediately", () => {
  setGlobal(JSON.stringify({ actions: ["opened"], reviewDrafts: true }));
  expect(triggerSkipReason(null, "opened", true)).toBeNull();
});

test("a per-repo override wins over the global rules", () => {
  setGlobal(JSON.stringify({ actions: ["opened", "synchronize"], reviewDrafts: false }));
  const repoOnly = JSON.stringify({ actions: ["opened"], reviewDrafts: true });

  // Global says synchronize is fine; this repo's override drops it.
  expect(triggerSkipReason(null, "synchronize", false)).toBeNull();
  expect(triggerSkipReason(repoOnly, "synchronize", false)).toBe("action not handled");
  // And the override's reviewDrafts wins too.
  expect(triggerSkipReason(null, "opened", true)).toBe("draft PR");
  expect(triggerSkipReason(repoOnly, "opened", true)).toBeNull();
});

test("an empty action list means never auto-review — it is not treated as unset", () => {
  setGlobal(JSON.stringify({ actions: [], reviewDrafts: false }));
  expect(triggerSkipReason(null, "opened", false)).toBe("action not handled");
  // A repo can still opt back in.
  expect(
    triggerSkipReason(JSON.stringify({ actions: ["opened"], reviewDrafts: false }), "opened", false),
  ).toBeNull();
});

test("malformed stored JSON falls back instead of taking the webhook path down", () => {
  for (const bad of ["not json at all", "[]", "null", "{}", '{"actions":"opened"}', ""]) {
    expect(resolveTriggers(bad)).toEqual(DEFAULT_TRIGGERS);
    expect(triggerSkipReason(bad, "opened", false)).toBeNull();
  }
  // A bad *global* row falls back to the defaults as well.
  setGlobal("{oops");
  expect(resolveTriggers(null)).toEqual(DEFAULT_TRIGGERS);
  // A bad repo value falls through to a valid global row, not straight to the defaults.
  setGlobal(JSON.stringify({ actions: ["opened"], reviewDrafts: false }));
  expect(triggerSkipReason("{oops", "synchronize", false)).toBe("action not handled");
});

test("unknown action strings in a stored rule are dropped, not stored-and-obeyed", () => {
  const raw = JSON.stringify({ actions: ["opened", "assigned", "opened"], reviewDrafts: false });
  expect(resolveTriggers(raw)).toEqual({ actions: ["opened"], reviewDrafts: false });
  expect(triggerSkipReason(raw, "assigned", false)).toBe("action not handled");
});
