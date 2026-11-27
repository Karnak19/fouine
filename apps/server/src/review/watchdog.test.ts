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

// Only shapes the watchdog reads. v2 envelopes carry their payload under
// `data`, with the session id at `data.sessionID`. Tool lifecycle rides one
// event per step keyed by the call id at `data.id`: input.started names the
// tool, called carries the resolved input, success/failed settle it. Names and
// shapes verified against a real opencode 2.4.2 event stream.
const toolEvents = (sessionID: string, callID: string, status: string, input: unknown) => {
  const base = { sessionID, assistantMessageID: "msg", id: callID };
  if (status === "running") {
    return [
      { type: "session.tool.input.started", data: { ...base, name: "bash" } },
      { type: "session.tool.called", data: { ...base, input, executed: true } },
    ];
  }
  if (status === "completed") {
    return [{ type: "session.tool.success", data: { ...base, content: [{ type: "text", text: "ok" }], executed: true } }];
  }
  return [{ type: "session.tool.failed", data: { ...base, error: { type: "tool", message: "boom" }, executed: true } }];
};
const toolEvent = (sessionID: string, callID: string, status: string, input: unknown) =>
  toolEvents(sessionID, callID, status, input).at(-1)!;
const observeTool = (
  state: ReturnType<typeof newActivityState>,
  sessionID: string,
  callID: string,
  status: string,
  input: unknown,
  now: number,
) => {
  for (const ev of toolEvents(sessionID, callID, status, input)) observeEvent(state, ev, sessionID, now);
};

const statusEvent = (sessionID: string) => ({
  type: "session.execution.started",
  data: { sessionID },
});

test("session id is read from every place events put it", () => {
  expect(eventSessionId(statusEvent("s1"))).toBe("s1");
  expect(eventSessionId(toolEvent("s1", "c1", "running", {}))).toBe("s1");
  // v2 unified the id under `data.sessionID` for every session-scoped event.
  const stepStarted = { type: "session.step.started", data: { sessionID: "s1", assistantMessageID: "msg" } };
  expect(eventSessionId(stepStarted)).toBe("s1");
  expect(eventSessionId({ type: "plugin.added", data: { id: "agent" } })).toBeUndefined();
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
  observeTool(state, "s1", "c1", "running", { command: "rg -r /root/.bun" }, 1_000);

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
  observeTool(state, "s1", "c1", "running", { command: "ls" }, 1_000);
  observeTool(state, "s1", "c1", "completed", { command: "ls" }, 2_000);
  expect(stalledTool(state)).toBeUndefined();
  expect(watchdogVerdict(state, 90_000, IDLE, CEILING)).toBe(
    "no activity for 88s (no tool in flight, last tool: bash)",
  );
});

test("re-published running states keep the original start time", () => {
  const state = newActivityState(0);
  state.armed = true;
  // A re-published `called` (or progress chatter) must not reset the wedge
  // duration: it is measured from the first one, not the last.
  observeTool(state, "s1", "c1", "running", { command: "sleep 999" }, 1_000);
  observeTool(state, "s1", "c1", "running", { command: "sleep 999" }, 40_000);
  expect(stalledTool(state)?.startedAt).toBe(1_000);
});

test("a failed tool call clears the in-flight entry too", () => {
  const state = newActivityState(0);
  state.armed = true;
  observeTool(state, "s1", "c1", "running", { command: "false" }, 1_000);
  observeTool(state, "s1", "c1", "error", { command: "false" }, 2_000);
  expect(stalledTool(state)).toBeUndefined();
  expect(state.toolNames.size).toBe(0);
});

test("the replay-only whole-content republish is not read for tool state", () => {
  // opencode never publishes session.message.content.updated live; it must
  // still count as activity but cannot start a tool call.
  const state = newActivityState(0);
  observeEvent(
    state,
    {
      type: "session.message.content.updated",
      data: { sessionID: "s1", messageID: "m", content: [{ type: "tool", id: "c1", name: "bash", state: { status: "running" } }] },
    },
    "s1",
    1_000,
  );
  expect(state.armed).toBe(true);
  expect(stalledTool(state)).toBeUndefined();
});
