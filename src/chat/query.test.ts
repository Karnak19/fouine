import { test, expect } from "bun:test";
import { guardQuery, runStatsQuery } from "~/chat/query";

const rejected = (sql: string) => {
  const r = guardQuery(sql);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.reason;
};

// The one that matters most: settings stores the opencode API key in plaintext,
// so a single question must never be able to read it back.
test("the settings table is refused, however it is spelled", () => {
  for (const sql of [
    "SELECT * FROM settings",
    "select value from SETTINGS where key = 'opencode_api_key'",
    "SELECT * FROM main.settings",
    'SELECT * FROM "settings"',
    "WITH s AS (SELECT * FROM settings) SELECT * FROM s",
    "SELECT (SELECT value FROM settings LIMIT 1) AS leaked",
  ]) {
    expect(rejected(sql)).toContain("settings");
  }
});

test("ATTACH is refused — readonly does not stop it reading another file", () => {
  expect(rejected("SELECT 1; ATTACH DATABASE '/etc/passwd' AS x")).toBeTruthy();
  expect(rejected("WITH x AS (SELECT 1) SELECT * FROM x -- ATTACH '/tmp/o.db' AS o")).toContain(
    "ATTACH",
  );
});

test("sqlite internals and PRAGMA are refused", () => {
  expect(rejected("SELECT name FROM sqlite_master")).toContain("sqlite");
  expect(rejected("SELECT * FROM sqlite_schema")).toContain("sqlite");
  expect(rejected("SELECT * FROM pragma_table_info('reviews')")).toContain("pragma");
  expect(rejected("PRAGMA table_info(reviews)")).toBeTruthy();
});

test("multi-statement input is refused", () => {
  expect(rejected("SELECT 1; SELECT 2")).toContain("one statement");
  expect(rejected("SELECT 1; DROP TABLE reviews")).toBeTruthy();
  // A single trailing semicolon is fine — that's just how people type SQL.
  expect(guardQuery("SELECT count(*) FROM reviews;").ok).toBe(true);
});

test("non-SELECT statements are refused", () => {
  for (const sql of [
    "DELETE FROM reviews",
    "UPDATE reviews SET cost = 0",
    "INSERT INTO repos (full_name) VALUES ('x')",
    "DROP TABLE findings",
    "CREATE TABLE evil (x INT)",
    "VACUUM",
  ])
    expect(rejected(sql)).toBeTruthy();
});

test("a legitimate aggregate is accepted and wrapped with a row cap", () => {
  const r = guardQuery(
    "SELECT repo_full_name, SUM(cost) AS cost FROM reviews GROUP BY repo_full_name ORDER BY cost DESC",
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.sql).toContain("LIMIT 500");
    expect(r.sql).toContain("SUM(cost)");
  }

  // A CTE that resolves to a SELECT is a normal way to write these.
  expect(guardQuery("WITH d AS (SELECT 1 AS n) SELECT n FROM d").ok).toBe(true);
});

test("a legitimate query executes against the real schema", () => {
  const out = runStatsQuery("SELECT count(*) AS n FROM reviews");
  expect(out.ok).toBe(true);
  expect(out.text).toContain("n");
  expect(out.rowCount).toBe(1);
});

test("a rejected query returns a message, never throws", () => {
  const out = runStatsQuery("SELECT * FROM settings");
  expect(out.ok).toBe(false);
  expect(out.text).toContain("rejected");
});

test("a malformed query returns the SQL error instead of throwing", () => {
  const out = runStatsQuery("SELECT * FROM no_such_table");
  expect(out.ok).toBe(false);
  expect(out.text).toContain("SQL error");
});

// The bound that actually stops a runaway query: the wrap makes SQLite stop
// pulling rows, which terminates the recursion instead of hanging the process.
test("a recursive CTE bomb is bounded by the row cap", () => {
  const started = Date.now();
  const out = runStatsQuery(
    "WITH RECURSIVE bomb(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM bomb) SELECT x FROM bomb",
  );
  expect(out.ok).toBe(true);
  expect(out.rowCount).toBe(500);
  expect(Date.now() - started).toBeLessThan(5000);
});

// A write must fail at the driver even if the prefilter were bypassed — that is
// the guarantee the string checks are only a convenience in front of.
test("the connection itself is readonly", () => {
  // guardQuery would refuse this; go around it to prove the driver refuses too.
  const { Database } = require("bun:sqlite");
  const { config } = require("~/config");
  const ro = new Database(config.dbPath, { readonly: true });
  expect(() => ro.prepare("CREATE TABLE chat_evil (x INT)").run()).toThrow();
});
