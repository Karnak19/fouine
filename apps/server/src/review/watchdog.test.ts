import { expect, test } from "bun:test";
import {
  eventSessionId,
  newActivityState,
  observeEvent,
  stalledTool,
  watchdogVerdict,
} from "~/review/opencode";

const IDLE = 60_000;
const CEILING = 600_000;

// Only shapes the watchdog reads. Field names verified against
// @opencode-ai/sdk 1.18.11 types and against the running 1.18.18 binary.
const toolEvent = (sessionID: string, callID: string, status: string, input: unknown) => ({
  type: "message.part.updated",
  properties: {
    part: {
      type: "tool",
      sessionID,
      messageID: "msg",
      id: "prt",
      callID,
      tool: "bash",
      state: { status, input },
    },
  },
});

const statusEvent = (sessionID: string) => ({
  type: "session.status",
  properties: { sessionID, status: { type: "busy" } },
});

test("session id is read from every place events put it", () => {
  expect(eventSessionId(statusEvent("s1"))).toBe("s1");
  expect(eventSessionId(toolEvent("s1", "c1", "running", {}))).toBe("s1");
  const msgUpdated = { type: "message.updated", properties: { info: { sessionID: "s1" } } };
  expect(eventSessionId(msgUpdated)).toBe("s1");
  expect(eventSessionId({ type: "plugin.added", properties: { id: "agent" } })).toBeUndefined();
});

// THE REGRESSION. Shipped in #67 and it killed every review in production at
// exactly idleTimeoutMs, mid-work, reporting "no tool calls seen": the watchdog
// armed itself when the SSE socket opened, but the socket was subscribed without
// the review's `directory`, so opencode routed it to a different project instance
// and not one event ever matched the session. A live stream of somebody else's
// events is indistinguishable from a silent model unless arming requires a MATCH.
test("a stream that never matches the session cannot trip the idle rule", () => {
  const state = newActivityState(0);

  // Plenty of traffic, none of it ours: another review's session, plus the
  // server-wide events that carry no session id at all.
  for (let now = 1_000; now <= 5 * IDLE; now += 1_000) {
    observeEvent(state, statusEvent("someone-else"), "s1", now);
    observeEvent(state, { type: "plugin.added", properties: { id: "agent" } }, "s1", now);
    // Way past the idle window, and still not a kill — only the ceiling may fire.
    expect(watchdogVerdict(state, now, IDLE, CEILING)).toBeNull();
  }
  expect(state.armed).toBe(false);
  expect(state.lastActivity).toBe(0);

  // The ceiling is the only thing left, and it still works.
  expect(watchdogVerdict(state, CEILING + 1, IDLE, CEILING)).toContain("ceiling");

  // One matching event arms it, and only then does idleness mean anything.
  observeEvent(state, statusEvent("s1"), "s1", 10_000);
  expect(state.armed).toBe(true);
  expect(watchdogVerdict(state, 10_000 + IDLE + 1, IDLE, CEILING)).toContain("no activity");
});

test("an undefined session id drops everything rather than arming", () => {
  const state = newActivityState(0);
  // The window between subscribe and session.create: events arrive before we
  // know what to match them against. Dropping them must not arm the rule.
  observeEvent(state, statusEvent("s1"), undefined, 1_000);
  expect(state.armed).toBe(false);
  expect(watchdogVerdict(state, IDLE + 2_000, IDLE, CEILING)).toBeNull();
});

test("steady activity never trips the idle rule", () => {
  const state = newActivityState(0);
  state.armed = true;
  // A heartbeat every 30s for well past the idle window: elapsed time grows but
  // the run is alive, so the watchdog must stay silent right up to the ceiling.
  for (let now = 30_000; now <= 500_000; now += 30_000) {
    observeEvent(state, statusEvent("s1"), "s1", now);
    expect(watchdogVerdict(state, now, IDLE, CEILING)).toBeNull();
  }
});

test("a silent gap trips the idle rule and names the hanging command", () => {
  const state = newActivityState(0);
  state.armed = true;
  const running = toolEvent("s1", "c1", "running", { command: "rg -r /root/.bun" });
  observeEvent(state, running, "s1", 1_000);

  expect(watchdogVerdict(state, 60_000, IDLE, CEILING)).toBeNull();
  expect(watchdogVerdict(state, 90_000, IDLE, CEILING)).toBe(
    'no activity for 89s (in-flight tool bash running 89s: {"command":"rg -r /root/.bun"})',
  );
  expect(stalledTool(state)?.tool).toBe("bash");
});

test("without a live stream idleness is not judged — only the ceiling", () => {
  const state = newActivityState(0);
  // streaming stays false: subscription never opened, or died mid-run.
  expect(watchdogVerdict(state, 500_000, IDLE, CEILING)).toBeNull();
  expect(watchdogVerdict(state, 600_001, IDLE, CEILING)).toBe("exceeded absolute ceiling of 600s");
});

test("the absolute ceiling still fires while events keep arriving", () => {
  const state = newActivityState(0);
  state.armed = true;
  observeEvent(state, statusEvent("s1"), "s1", 600_001);
  expect(watchdogVerdict(state, 600_001, IDLE, CEILING)).toBe("exceeded absolute ceiling of 600s");
});

test("events for other sessions are not activity", () => {
  const state = newActivityState(0);
  state.armed = true;
  observeEvent(state, statusEvent("other"), "s1", 500_000);
  expect(watchdogVerdict(state, 61_000, IDLE, CEILING)).toContain("no activity for 61s");
});

test("a completed tool call clears the in-flight entry", () => {
  const state = newActivityState(0);
  state.armed = true;
  observeEvent(state, toolEvent("s1", "c1", "running", { command: "ls" }), "s1", 1_000);
  observeEvent(state, toolEvent("s1", "c1", "completed", { command: "ls" }), "s1", 2_000);
  expect(stalledTool(state)).toBeUndefined();
  expect(watchdogVerdict(state, 90_000, IDLE, CEILING)).toBe(
    "no activity for 88s (no tool in flight, last tool: bash)",
  );
});

test("re-published running states keep the original start time", () => {
  const state = newActivityState(0);
  state.armed = true;
  // opencode re-emits `running` on every bash output chunk; the wedge duration
  // must be measured from the first one, not the last.
  observeEvent(state, toolEvent("s1", "c1", "running", { command: "sleep 999" }), "s1", 1_000);
  observeEvent(state, toolEvent("s1", "c1", "running", { command: "sleep 999" }), "s1", 40_000);
  expect(stalledTool(state)?.startedAt).toBe(1_000);
});
