import { test, expect } from "bun:test";
import {
  createTranscriptStream,
  MAX_OUTPUT,
  MAX_TEXT,
  type TranscriptDelta,
} from "~/review/transcript";

const SESSION = "ses_1";

// v2's content carrier: the whole content array of one message, republished on
// every change.
const contentEvent = (content: Record<string, unknown>[]) => ({
  type: "session.message.content.updated",
  data: { sessionID: SESSION, messageID: "msg_1", content },
});

const textPart = (text: string) => ({ type: "text", text });

const toolPart = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "prt_tool",
  type: "tool",
  name: "bash",
  state: { status, input: { command: "x".repeat(5_000) }, ...extra },
});

const stepEvent = (assistantMessageID: string) => ({
  type: "session.step.started",
  data: { sessionID: SESSION, assistantMessageID },
});

const flat = (deltas: TranscriptDelta[]) => deltas.map((d) => d.part ?? d);

test("emits a message shell once per message", () => {
  const s = createTranscriptStream();
  expect(s.observe(stepEvent("msg_1"), SESSION, 0)).toEqual([
    { messageId: "msg_1", role: "assistant" },
  ]);
  // opencode re-fires step.started across retries/compaction passes.
  expect(s.observe(stepEvent("msg_1"), SESSION, 10)).toEqual([]);
});

test("ignores other sessions and unknown-session runs", () => {
  const s = createTranscriptStream();
  expect(s.observe(contentEvent([textPart("hi")]), "other", 0)).toEqual([]);
  expect(s.observe(contentEvent([textPart("hi")]), undefined, 0)).toEqual([]);
});

test("drops part types the transcript renders as nothing", () => {
  const s = createTranscriptStream();
  for (const type of ["snapshot", "patch", "agent-switched"]) {
    expect(s.observe(contentEvent([{ type }]), SESSION, 0)).toEqual([]);
  }
});

test("truncates text and tool output, and never forwards tool input", () => {
  const s = createTranscriptStream();
  const [text] = s.observe(
    contentEvent([{ type: "text", text: "a".repeat(MAX_TEXT + 500) }]),
    SESSION,
    0,
  );
  expect(text.part!.text!.length).toBe(MAX_TEXT + 1); // + the ellipsis
  expect(text.part!.id).toBe("msg_1:0");

  const [tool] = s.observe(
    contentEvent([toolPart("completed", { content: [{ type: "text", text: "o".repeat(MAX_OUTPUT + 500) }] })]),
    SESSION,
    0,
  );
  expect(tool.part!.state!.output!.length).toBe(MAX_OUTPUT + 1);
  // v2 dropped v1's server-side `state.title`, so the fold synthesizes a label
  // from the tool input (the only field the UI has to name the call). It must
  // stay a bounded summary: bash re-publishes the raw input — the command — on
  // every output chunk, and that must never ride the wire in full.
  expect(tool.part!.state).not.toHaveProperty("input");
  expect(tool.part!.state!.title!.length).toBe(201); // 200-char clamp + the ellipsis
  expect(JSON.stringify(tool)).not.toContain("x".repeat(500));
  expect(tool.part!.tool).toBe("bash");
});

test("coalesces a chatty part but always lets a terminal tool status through", () => {
  const s = createTranscriptStream(400);
  const got: TranscriptDelta[] = [];
  const push = (deltas: TranscriptDelta[]) => got.push(...deltas);

  // The bash flood: `running` re-published on every output chunk.
  push(s.observe(contentEvent([toolPart("running", { content: [{ type: "text", text: "1" }] })]), SESSION, 0));
  push(s.observe(contentEvent([toolPart("running", { content: [{ type: "text", text: "12" }] })]), SESSION, 50));
  push(s.observe(contentEvent([toolPart("running", { content: [{ type: "text", text: "123" }] })]), SESSION, 100));
  expect(got).toHaveLength(1);

  // Past the window, one more frame gets through.
  push(s.observe(contentEvent([toolPart("running", { content: [{ type: "text", text: "1234" }] })]), SESSION, 500));
  expect(got).toHaveLength(2);

  // Completion must never be coalesced away, or the UI spins forever.
  push(s.observe(contentEvent([toolPart("completed", { content: [{ type: "text", text: "done" }] })]), SESSION, 510));
  expect(got).toHaveLength(3);
  expect(got[2].part!.state!.status).toBe("completed");
});

test("an unchanged whole-array republish forwards nothing", () => {
  const s = createTranscriptStream(400);
  const content = [textPart("stable"), toolPart("running", { content: [{ type: "text", text: "1" }] })];
  const first = s.observe(contentEvent(content), SESSION, 0);
  expect(first).toHaveLength(2);
  // Identical state (sig recorded on pass) → skipped even though the gate
  // window has elapsed; a real session always changes something.
  expect(s.observe(contentEvent(content), SESSION, 500)).toEqual([]);
});

test("a coalesced change stays pending until a later frame gets through", () => {
  const s = createTranscriptStream(400);
  expect(s.observe(contentEvent([toolPart("running", { content: [{ type: "text", text: "1" }] })]), SESSION, 0)).toHaveLength(1);
  // Within the window: dropped, signature NOT recorded.
  expect(s.observe(contentEvent([toolPart("running", { content: [{ type: "text", text: "12" }] })]), SESSION, 10)).toEqual([]);
  // After the window the SAME state forwards (no change lost to the gate).
  expect(s.observe(contentEvent([toolPart("running", { content: [{ type: "text", text: "12" }] })]), SESSION, 500)).toHaveLength(1);
});

test("distinct parts are gated independently", () => {
  const s = createTranscriptStream(400);
  expect(s.observe(contentEvent([textPart("1")]), SESSION, 0)).toHaveLength(1);
  const [b] = s.observe(
    contentEvent([textPart("1"), textPart("2")]),
    SESSION,
    1,
  );
  // Only the NEW part forwards; part 0 is unchanged.
  expect(b.part!.id).toBe("msg_1:1");
  expect(s.observe(contentEvent([textPart("1"), textPart("3")]), SESSION, 2)).toEqual([]);
});

test("survives malformed events instead of throwing at the pump", () => {
  const s = createTranscriptStream();
  for (const bad of [null, undefined, {}, { type: "session.message.content.updated" }, "nope", 42]) {
    expect(s.observe(bad, SESSION, 0)).toEqual([]);
  }
  // A content array that isn't one can't be folded.
  expect(s.observe({ type: "session.message.content.updated", data: { sessionID: SESSION } }, SESSION, 0)).toEqual([]);
});

test("flat() helper unpacks parts", () => {
  expect(flat([{ messageId: "m", part: { id: "p", type: "text", text: "x" } }])).toEqual([
    { id: "p", type: "text", text: "x" },
  ]);
});
