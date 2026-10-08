import { test, expect } from "bun:test";
import { runCodemode, codemodeInstructions } from "~/chat/codemode";

test("a program can query and gets rows back as data", async () => {
  const out = await runCodemode(`
    const r = await tools.stats.query({ sql: "SELECT 1 AS n, 'a' AS s" })
    return { rowCount: r.rowCount, first: r.rows[0] }
  `);
  expect(out.ok).toBe(true);
  if (out.ok) expect(out.value).toEqual({ rowCount: 1, first: { n: 1, s: "a" } });
  expect(out.calls.map((c) => c.name)).toEqual(["stats.query"]);
  expect(out.calls[0]?.outcome).toBe("success");
  expect(out.charts).toEqual([]);
});

test("render_chart inside a program lands in charts, the program gets a compact value", async () => {
  const out = await runCodemode(`
    const c = await tools.stats.render_chart({
      sql: "SELECT 'a' AS k, 3 AS n UNION ALL SELECT 'b', 5",
      type: "bar", title: "T", x: "k", y: "n",
    })
    console.log("drew", c.rowCount)
    return c.rows
  `);
  expect(out.ok).toBe(true);
  if (out.ok) expect(out.value).toEqual([{ k: "a", n: 3 }, { k: "b", n: 5 }]);
  expect(out.logs).toEqual(["drew 2"]);
  expect(out.charts).toHaveLength(1);
  expect(out.charts[0]?.spec.title).toBe("T");
  expect(out.charts[0]?.rows).toHaveLength(2);
});

test("charts are collected per execution, not shared across runs", async () => {
  const code = `await tools.stats.render_chart({ sql: "SELECT 'a' AS k, 1 AS n", type: "bar", title: "T", x: "k", y: "n" })`;
  const [a, b] = await Promise.all([runCodemode(code), runCodemode(code)]);
  expect(a.charts).toHaveLength(1);
  expect(b.charts).toHaveLength(1);
});

test("a rejected query is a tool failure the program can catch or that ends it, never a throw", async () => {
  const out = await runCodemode(`return await tools.stats.query({ sql: "SELECT * FROM settings" })`);
  expect(out.ok).toBe(false);
  if (!out.ok) {
    expect(out.error.kind).toBe("ToolFailure");
    expect(out.error.message).toContain("settings");
  }

  const caught = await runCodemode(`
    try { await tools.stats.query({ sql: "DROP TABLE reviews" }) } catch (e) { return e.message }
  `);
  expect(caught.ok).toBe(true);
  if (caught.ok) expect(String(caught.value)).toContain("Query rejected");
});

test("a bad chart column fails with a message and records no chart", async () => {
  const out = await runCodemode(
    `return await tools.stats.render_chart({ sql: "SELECT 1 AS a", type: "bar", title: "T", x: "nope", y: "a" })`,
  );
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.message).toContain("Available columns");
  expect(out.charts).toEqual([]);
});

test("a program error comes back as ok:false, not a throw", async () => {
  for (const code of ["throw new Error('boom')", "this is not javascript (", "return nope.x", "import fs from 'fs'"]) {
    const out = await runCodemode(code);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.message.length).toBeGreaterThan(0);
  }
});

test("the tool-call limit stops a runaway program", async () => {
  const out = await runCodemode(
    `for (let i = 0; i < 50; i++) { await tools.stats.query({ sql: "SELECT 1" }) }`,
  );
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.kind).toBe("ToolCallLimitExceeded");
});

// The interpreter runs on the main thread, which also serves webhooks. The
// timeout has to interrupt a busy loop AND leave the event loop turning.
test("the timeout interrupts a busy loop without freezing the process", async () => {
  let ticks = 0;
  const iv = setInterval(() => ticks++, 50);
  try {
    for (const code of ["while (true) {}", "for (let i = 0; i < 1e9; i++) {}"]) {
      ticks = 0;
      const started = Date.now();
      const out = await runCodemode(code, undefined, { timeoutMs: 1_000 });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.kind).toBe("TimeoutExceeded");
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(ticks).toBeGreaterThan(10);
    }
  } finally {
    clearInterval(iv);
  }
});

test("aborting the request interrupts a running program", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 200);
  const started = Date.now();
  const out = await runCodemode("while (true) {}", ac.signal);
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.message).toContain("stopped");
});

test("the instructions inline both tools with their signatures", () => {
  const text = codemodeInstructions();
  expect(text).toContain("tools.stats.query");
  expect(text).toContain("tools.stats.render_chart");
});
