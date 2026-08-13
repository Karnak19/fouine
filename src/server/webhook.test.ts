import { test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyAndDispatch, VerificationError, isStopCommand } from "~/server/webhook";

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

test("recognises /review stop, and only stop", () => {
  expect(isStopCommand("/review stop")).toBe(true);
  expect(isStopCommand("  /review   stop  ")).toBe(true);
  expect(isStopCommand("/review")).toBe(false);
  // Must not swallow a plain review request that merely starts with "stop".
  expect(isStopCommand("/review stopwatch")).toBe(false);
  expect(isStopCommand("/review stop please")).toBe(false);
});
