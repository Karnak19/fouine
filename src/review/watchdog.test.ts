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

test("steady activity never trips the idle rule", () => {
  const state = newActivityState(0);
  state.streaming = true;
  // A heartbeat every 30s for well past the idle window: elapsed time grows but
  // the run is alive, so the watchdog must stay silent right up to the ceiling.
  for (let now = 30_000; now <= 500_000; now += 30_000) {
    observeEvent(state, statusEvent("s1"), "s1", now);
    expect(watchdogVerdict(state, now, IDLE, CEILING)).toBeNull();
  }
});

test("a silent gap trips the idle rule and names the hanging command", () => {
  const state = newActivityState(0);
  state.streaming = true;
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
  state.streaming = true;
  observeEvent(state, statusEvent("s1"), "s1", 600_001);
  expect(watchdogVerdict(state, 600_001, IDLE, CEILING)).toBe("exceeded absolute ceiling of 600s");
});

test("events for other sessions are not activity", () => {
  const state = newActivityState(0);
  state.streaming = true;
  observeEvent(state, statusEvent("other"), "s1", 500_000);
  expect(watchdogVerdict(state, 61_000, IDLE, CEILING)).toContain("no activity for 61s");
});

test("a completed tool call clears the in-flight entry", () => {
  const state = newActivityState(0);
  state.streaming = true;
  observeEvent(state, toolEvent("s1", "c1", "running", { command: "ls" }), "s1", 1_000);
  observeEvent(state, toolEvent("s1", "c1", "completed", { command: "ls" }), "s1", 2_000);
  expect(stalledTool(state)).toBeUndefined();
  expect(watchdogVerdict(state, 90_000, IDLE, CEILING)).toBe(
    "no activity for 88s (no tool in flight, last tool: bash)",
  );
});

test("re-published running states keep the original start time", () => {
  const state = newActivityState(0);
  state.streaming = true;
  // opencode re-emits `running` on every bash output chunk; the wedge duration
  // must be measured from the first one, not the last.
  observeEvent(state, toolEvent("s1", "c1", "running", { command: "sleep 999" }), "s1", 1_000);
  observeEvent(state, toolEvent("s1", "c1", "running", { command: "sleep 999" }), "s1", 40_000);
  expect(stalledTool(state)?.startedAt).toBe(1_000);
});
