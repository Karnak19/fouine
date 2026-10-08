import { test, expect } from "bun:test";
import {
  buildTaskPrompt,
  NEEDS_INPUT_MARKER,
  parseNeedsInput,
  taskBranch,
  taskTitle,
  TASK_BRANCH_PREFIX,
} from "~/review/task-prompt";

test("the task branch is unique per run id and carries the merger's prefix", () => {
  expect(taskBranch(7)).toBe("fouine/task-7");
  expect(taskBranch(7).startsWith(TASK_BRANCH_PREFIX)).toBe(true);
  expect(taskBranch(8)).not.toBe(taskBranch(7));
});

test("only a reply that STARTS with the marker means needs input", () => {
  expect(parseNeedsInput(`${NEEDS_INPUT_MARKER} which branch?`)).toBe("which branch?");
  expect(parseNeedsInput(`  \n${NEEDS_INPUT_MARKER}\nA or B?`)).toBe("A or B?");
  expect(parseNeedsInput(`Done. ${NEEDS_INPUT_MARKER} not really`)).toBeNull();
  expect(parseNeedsInput("changed three files")).toBeNull();
});

test("title is the first line, capped", () => {
  expect(taskTitle("Upgrade next\nmore detail")).toBe("Upgrade next");
  expect(taskTitle("x".repeat(200)).length).toBe(80);
  expect(taskTitle("   ")).toBe("Task");
});

test("the prompt carries the repo, branch, request and the marker protocol", () => {
  const p = buildTaskPrompt({ repoFullName: "a/b", branch: "fouine/task-3", prompt: "Do X" });
  expect(p).toContain("a/b");
  expect(p).toContain("fouine/task-3");
  expect(p).toContain("Do X");
  expect(p).toContain(NEEDS_INPUT_MARKER);
});
