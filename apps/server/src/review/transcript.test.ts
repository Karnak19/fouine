import { test, expect } from "bun:test";
import {
  createTranscriptStream,
  MAX_OUTPUT,
  MAX_TEXT,
  type TranscriptDelta,
} from "~/review/transcript";

const SESSION = "ses_1";

const partEvent = (part: Record<string, unknown>) => ({
  type: "message.part.updated",
  properties: { part: { sessionID: SESSION, messageID: "msg_1", ...part } },
});

const toolEvent = (status: string, extra: Record<string, unknown> = {}) =>
  partEvent({
    id: "prt_tool",
    type: "tool",
    tool: "bash",
    state: { status, input: { command: "x".repeat(5_000) }, ...extra },
  });

test("emits a message shell once per message", () => {
  const s = createTranscriptStream();
  const ev = {
    type: "message.updated",
    properties: { info: { id: "msg_1", sessionID: SESSION, role: "assistant" } },
  };
  expect(s.observe(ev, SESSION, 0)).toEqual({ messageId: "msg_1", role: "assistant" });
  // opencode re-fires message.updated on every token-count change.
  expect(s.observe(ev, SESSION, 10)).toBeNull();
});

test("ignores other sessions and unknown-session runs", () => {
  const s = createTranscriptStream();
  expect(s.observe(partEvent({ id: "p", type: "text", text: "hi" }), "other", 0)).toBeNull();
  expect(s.observe(partEvent({ id: "p", type: "text", text: "hi" }), undefined, 0)).toBeNull();
});

test("drops part types the transcript renders as nothing", () => {
  const s = createTranscriptStream();
  for (const type of ["step-start", "step-finish", "snapshot", "patch"]) {
    expect(s.observe(partEvent({ id: `p-${type}`, type }), SESSION, 0)).toBeNull();
  }
});

test("truncates text and tool output, and never forwards tool input", () => {
  const s = createTranscriptStream();
  const text = s.observe(
    partEvent({ id: "prt_text", type: "text", text: "a".repeat(MAX_TEXT + 500) }),
    SESSION,
    0,
  )!;
  expect(text.part!.text!.length).toBe(MAX_TEXT + 1); // + the ellipsis

  const tool = s.observe(toolEvent("running", { output: "o".repeat(MAX_OUTPUT + 500) }), SESSION, 0)!;
  expect(tool.part!.state!.output!.length).toBe(MAX_OUTPUT + 1);
  // The single largest repeated field on the wire — bash re-publishes it on
  // every output chunk — must not be on the wire at all.
  expect(JSON.stringify(tool)).not.toContain("command");
});

test("coalesces a chatty part but always lets a terminal tool status through", () => {
  const s = createTranscriptStream(400);
  const got: TranscriptDelta[] = [];
  const push = (d: TranscriptDelta | null) => d && got.push(d);

  // The bash flood: `running` re-published on every output chunk.
  push(s.observe(toolEvent("running", { output: "1" }), SESSION, 0));
  push(s.observe(toolEvent("running", { output: "12" }), SESSION, 50));
  push(s.observe(toolEvent("running", { output: "123" }), SESSION, 100));
  expect(got).toHaveLength(1);

  // Past the window, one more frame gets through.
  push(s.observe(toolEvent("running", { output: "1234" }), SESSION, 500));
  expect(got).toHaveLength(2);

  // Completion must never be coalesced away, or the UI spins forever.
  push(s.observe(toolEvent("completed", { output: "done" }), SESSION, 510));
  expect(got).toHaveLength(3);
  expect(got[2].part!.state!.status).toBe("completed");
});

test("distinct parts are gated independently", () => {
  const s = createTranscriptStream(400);
  expect(s.observe(partEvent({ id: "a", type: "text", text: "1" }), SESSION, 0)).not.toBeNull();
  expect(s.observe(partEvent({ id: "b", type: "text", text: "2" }), SESSION, 1)).not.toBeNull();
  expect(s.observe(partEvent({ id: "a", type: "text", text: "3" }), SESSION, 2)).toBeNull();
});

test("survives malformed events instead of throwing at the pump", () => {
  const s = createTranscriptStream();
  for (const bad of [null, undefined, {}, { type: "message.part.updated" }, "nope", 42]) {
    expect(s.observe(bad, SESSION, 0)).toBeNull();
  }
  // A part with no id can't be merged client-side, so it's dropped too.
  expect(s.observe(partEvent({ type: "text", text: "x" }), SESSION, 0)).toBeNull();
});
