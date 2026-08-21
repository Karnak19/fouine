import { expect, test } from "bun:test";
// Not inside tools/: opencode loads every file in that dir looking for tools, so a
// test file there would be pulled into the review runtime (same reason as
// cap-bash-timeout.test.ts living one level up from plugin/).
import { type Annotation, type CheckRun, formatCiResults } from "./tools/_ci_format";

const SHA = "abcdef1234567890";

const run = (name: string, status: string, conclusion: string | null, annotations = 0): CheckRun => ({
  name,
  status,
  conclusion,
  output: { annotations_count: annotations },
});

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  path: "src/a.ts",
  start_line: 12,
  end_line: 12,
  annotation_level: "failure",
  message: "Type 'string' is not assignable to type 'number'.",
  ...over,
});

test("no check runs is never reported as green", () => {
  const out = formatCiResults(SHA, [], new Map());
  expect(out).toContain("No check runs");
  expect(out).toContain("do not read this as CI passing");
});

test("pending runs are named and flagged, not hidden behind the passing ones", () => {
  const out = formatCiResults(
    SHA,
    [run("unit", "completed", "success"), run("e2e", "in_progress", null), run("build", "queued", null)],
    new Map(),
  );
  expect(out).toContain("STILL RUNNING (2)");
  expect(out).toContain("e2e (in_progress)");
  expect(out).toContain("build (queued)");
  expect(out).toContain("CI IS NOT FINISHED");
  expect(out).toContain("Do not claim this PR passes CI");
});

test("no pending section when every run has finished", () => {
  const out = formatCiResults(SHA, [run("unit", "completed", "success")], new Map());
  expect(out).not.toContain("STILL RUNNING");
  expect(out).toContain("✅ Passed (1): unit (success)");
});

test("failure conclusions other than 'failure' still count as failed", () => {
  const out = formatCiResults(
    SHA,
    [run("unit", "completed", "timed_out"), run("lint", "completed", "skipped")],
    new Map(),
  );
  expect(out).toContain("❌ Failed (1): unit (timed_out)");
  expect(out).toContain("✅ Passed (1): lint (skipped)");
});

test("annotations render with file, line range and severity", () => {
  const out = formatCiResults(
    SHA,
    [run("typecheck", "completed", "failure", 2)],
    new Map([
      [
        "typecheck",
        [ann(), ann({ path: "src/b.ts", start_line: 3, end_line: 9, annotation_level: "warning", title: "no-unused" })],
      ],
    ]),
  );
  expect(out).toContain("## typecheck — failure");
  expect(out).toContain("- [failure] src/a.ts:12: Type 'string' is not assignable");
  expect(out).toContain("- [warning] src/b.ts:3-9: no-unused — ");
});

test("a failing run with no annotations says the detail is unavailable", () => {
  const out = formatCiResults(SHA, [run("e2e", "completed", "failure")], new Map());
  expect(out).toContain("published no annotations");
});

test("annotation list is capped and the truncation is stated", () => {
  const many = Array.from({ length: 60 }, (_, i) => ann({ start_line: i + 1 }));
  const out = formatCiResults(SHA, [run("lint", "completed", "failure", 60)], new Map([["lint", many]]));
  expect(out.match(/^- \[failure\]/gm)?.length).toBe(50);
  expect(out).toContain("(10 further annotation(s) truncated)");
});

test("failing runs' annotations win the cap over passing runs'", () => {
  const out = formatCiResults(
    SHA,
    [run("passing", "completed", "success", 50), run("failing", "completed", "failure", 5)],
    new Map([
      ["passing", Array.from({ length: 50 }, () => ann({ path: "passing.ts" }))],
      ["failing", Array.from({ length: 5 }, () => ann({ path: "failing.ts" }))],
    ]),
  );
  // All 5 failing annotations survive; the cap eats the tail of the passing run's.
  expect(out.match(/failing\.ts/g)?.length).toBe(5);
  expect(out.match(/passing\.ts/g)?.length).toBe(45);
  expect(out).toContain("(5 further annotation(s) truncated)");
  expect(out.indexOf("failing.ts")).toBeLessThan(out.indexOf("passing.ts"));
});

test("long messages are clipped and newlines flattened", () => {
  const out = formatCiResults(
    SHA,
    [run("unit", "completed", "failure", 1)],
    new Map([["unit", [ann({ message: `${"x".repeat(2000)}\nsecond line` })]]]),
  );
  expect(out).toContain("…(truncated)");
  expect(out.split("\n").filter((l) => l.startsWith("- [failure]")).length).toBe(1);
});
