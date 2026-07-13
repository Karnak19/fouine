import { test, expect } from "bun:test";
import { parseSkillUrl } from "~/skills/source";

test("parses a skills.sh registry URL", () => {
  const s = parseSkillUrl("https://www.skills.sh/dietrichgebert/ponytail/ponytail");
  expect(s).toEqual({ owner: "dietrichgebert", repo: "ponytail", skill: "ponytail" });
});

test("parses a bare github repo URL", () => {
  const s = parseSkillUrl("https://github.com/vercel-labs/skills.git");
  expect(s).toEqual({ owner: "vercel-labs", repo: "skills" });
});

test("parses a github tree URL into ref + path + skill", () => {
  const s = parseSkillUrl("https://github.com/vercel-labs/skills/tree/main/skills/find-skills");
  expect(s).toEqual({
    owner: "vercel-labs",
    repo: "skills",
    ref: "main",
    path: "skills/find-skills",
    skill: "find-skills",
  });
});

test("strips a trailing SKILL.md from a blob URL", () => {
  const s = parseSkillUrl("https://github.com/o/r/blob/dev/a/b/SKILL.md");
  expect(s.path).toBe("a/b");
  expect(s.skill).toBe("b");
});

test("rejects unsupported hosts and non-URLs", () => {
  expect(() => parseSkillUrl("https://gitlab.com/o/r")).toThrow();
  expect(() => parseSkillUrl("not a url")).toThrow();
  expect(() => parseSkillUrl("https://skills.sh/owner")).toThrow();
});
