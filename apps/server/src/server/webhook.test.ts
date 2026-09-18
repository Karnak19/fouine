import { test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import {
  verifyAndDispatch,
  VerificationError,
  isStopCommand,
  matchTrigger,
  refineFollowUpDecision,
} from "~/server/webhook";

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

test("recognises /fouine stop, and only stop", () => {
  expect(isStopCommand("/fouine stop")).toBe(true);
  expect(isStopCommand("  /fouine   stop  ")).toBe(true);
  expect(isStopCommand("/fouine")).toBe(false);
  // Must not swallow a plain review request that merely starts with "stop".
  expect(isStopCommand("/fouine stopwatch")).toBe(false);
  expect(isStopCommand("/fouine stop please")).toBe(false);
});

test("recognises /review stop through the deprecated alias", () => {
  expect(isStopCommand("/review stop")).toBe(true);
  expect(isStopCommand("  /review   stop  ")).toBe(true);
  expect(isStopCommand("/review")).toBe(false);
  expect(isStopCommand("/review stopwatch")).toBe(false);
  expect(isStopCommand("/review stop please")).toBe(false);
});

test("isStopCommand slices by the matched trigger, not a fixed length", () => {
  // A hardcoded slice would leave "e stop" here and miss the command.
  expect(isStopCommand("/fouine stop", "/fouine")).toBe(true);
  expect(isStopCommand("/review stop", "/review")).toBe(true);
  expect(isStopCommand("stop")).toBe(false);
});

test("matchTrigger returns the trigger a comment starts with", () => {
  expect(matchTrigger("/fouine")).toBe("/fouine");
  expect(matchTrigger("/fouine stop")).toBe("/fouine");
  expect(matchTrigger("  /fouine focus on the tests")).toBe("/fouine");
  expect(matchTrigger("/review please")).toBe("/review");
  expect(matchTrigger("looks good to me")).toBeUndefined();
  expect(matchTrigger("nice, /fouine later maybe")).toBeUndefined();
});

// refineFollowUpDecision: the pure decision behind the issue_comment follow-up
// path (a human replying to the refiner without typing a /fouine command).
const baseDecisionInput = {
  authorLogin: "ana",
  autoReady: true,
  labels: [] as string[],
  readyLabel: "fouine-ready",
  refineCount: 1,
};

test("refineFollowUpDecision: human reply with a prior refine runs another round", () => {
  expect(refineFollowUpDecision(baseDecisionInput)).toBe("run");
});

test("refineFollowUpDecision: a bot author is skipped (stops fouine re-triggering itself)", () => {
  expect(refineFollowUpDecision({ ...baseDecisionInput, authorLogin: "fouine[bot]" })).toBe("skip");
});

test("refineFollowUpDecision: the ready label already present is skipped", () => {
  expect(
    refineFollowUpDecision({ ...baseDecisionInput, labels: ["fouine-ready"] }),
  ).toBe("skip");
});

test("refineFollowUpDecision: autoReady off is skipped", () => {
  expect(refineFollowUpDecision({ ...baseDecisionInput, autoReady: false })).toBe("skip");
});

test("refineFollowUpDecision: no prior refine (count 0) is skipped", () => {
  expect(refineFollowUpDecision({ ...baseDecisionInput, refineCount: 0 })).toBe("skip");
});

test("refineFollowUpDecision: count 3 hits the cap", () => {
  expect(refineFollowUpDecision({ ...baseDecisionInput, refineCount: 3 })).toBe("cap");
});

test("refineFollowUpDecision: count 4 (cap already announced) is skipped", () => {
  expect(refineFollowUpDecision({ ...baseDecisionInput, refineCount: 4 })).toBe("skip");
});
