import { Database } from "bun:sqlite";
import { config } from "~/config";
// Imported for the side effect: src/db.ts owns the read/write handle that
// creates the file and the schema. A readonly connection cannot create either,
// so it must not be the first to open the path.
import "~/db";

// A SECOND connection to the same file, opened readonly. This is the primary
// guard: a write throws in the driver, not in a regex we have to get right.
// Separate from the app's read/write handle on purpose — nothing the chat agent
// does can reach a writable connection.
//
// Opened on first use rather than at import, so merely loading this module (a
// test, a CLI) doesn't hold a handle it never uses.
let ro: Database | undefined;
function readonlyDb(): Database {
  ro ??= new Database(config.dbPath, { readonly: true });
  return ro;
}

// Rows and bytes a single answer may pull back. Generous for an aggregate,
// small enough that a runaway query can't push the model's context over.
export const MAX_ROWS = 500;
const MAX_JSON_BYTES = 200_000;

/**
 * What the chat agent may never touch, and why. Do NOT trim this list thinking
 * it is paranoia — the first entry is the one that matters:
 *
 *  - `settings` holds the opencode API key in plaintext. Without this line a
 *    single innocent-looking question ("what settings are configured?")
 *    exfiltrates the key straight into a chat bubble.
 *  - `sqlite_master` / `sqlite_schema` and friends expose the full schema and
 *    would hand an attacker the map, including any table added later.
 *  - `ATTACH` reads ANOTHER FILE from disk. A readonly connection does not stop
 *    it — readonly constrains writes, not which databases you open — so an
 *    ATTACH of some other sqlite file on the host would be readable through it.
 *  - `PRAGMA` leaks schema and file paths, and some pragmas have side effects.
 *  - The write verbs are already impossible on a readonly connection; they are
 *    listed so the agent gets a clear refusal instead of a driver stack trace.
 */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bsettings\b/i,
    reason: "the settings table is off limits (it stores credentials)",
  },
  {
    pattern: /\bsqlite_[a-z_]+\b/i,
    reason: "sqlite internal tables are off limits",
  },
  {
    pattern: /\bpragma_[a-z_]+\b/i,
    reason: "pragma table-valued functions are off limits",
  },
  { pattern: /\battach\b/i, reason: "ATTACH is not allowed" },
  { pattern: /\bdetach\b/i, reason: "DETACH is not allowed" },
  { pattern: /\bpragma\b/i, reason: "PRAGMA is not allowed" },
  {
    pattern: /\b(insert|update|delete|drop|alter|create|replace|vacuum|reindex)\b/i,
    reason: "this tool is read-only — SELECT queries only",
  },
  // Value-inflation builtins. The row LIMIT below bounds how MANY rows come
  // back, but not how big ONE value can be: `SELECT hex(zeroblob(50000000))` is
  // a single row that materialises ~100MB in the driver before any cap of ours
  // can trim it. None of these have a legitimate use in a stats question.
  {
    pattern: /\b(zeroblob|randomblob|hex|unhex|char|printf|format|quote|group_concat|string_agg)\s*\(/i,
    reason: "blob and string-building functions are not allowed",
  },
];

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

// ponytail: a string prefilter in front of a readonly connection, NOT a SQL
// parser. It can be fooled by sufficiently creative lexical tricks, and it
// deliberately over-rejects (a query merely mentioning "settings" in a string
// literal is refused). That trade is right for what this is: a single-user
// dashboard already behind the GitHub OAuth gate, where the readonly handle is
// the real boundary and this list narrows what a confused model can ask for.
// If this ever faces untrusted users, put a real parser here instead.
export function guardQuery(raw: string): GuardResult {
  const sql = raw.trim().replace(/;\s*$/, "").trim();
  if (!sql) return { ok: false, reason: "empty query" };

  // One statement per call. The trailing semicolon is already gone, so any
  // remaining one means a second statement was appended.
  if (sql.includes(";")) {
    return { ok: false, reason: "one statement at a time — remove the extra ';'" };
  }

  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason: "only SELECT (or WITH ... SELECT) queries are allowed" };
  }

  for (const { pattern, reason } of FORBIDDEN) {
    if (pattern.test(sql)) return { ok: false, reason };
  }

  // The LIMIT is what actually bounds a runaway query. Wrapping in a subquery
  // makes SQLite stop pulling rows once the cap is reached, which terminates
  // even a recursive-CTE bomb (verified: `WITH RECURSIVE b(x) AS (SELECT 1
  // UNION ALL SELECT x+1 FROM b)` returns in ~1ms wrapped, never unwrapped).
  return { ok: true, sql: `SELECT * FROM (${sql}) LIMIT ${MAX_ROWS}` };
}

export interface QueryOutcome {
  ok: boolean;
  /** Rendered rows, or the refusal/error text when ok is false. */
  text: string;
  rowCount?: number;
  ms?: number;
}

export function runStatsQuery(raw: string): QueryOutcome {
  const guard = guardQuery(raw);
  if (!guard.ok) return { ok: false, text: `Query rejected: ${guard.reason}` };

  const started = Date.now();
  const rows: unknown[] = [];
  let budget = MAX_JSON_BYTES;
  let truncated = false;
  try {
    // iterate(), not all(): the byte budget is spent as rows arrive, so a query
    // whose ROWS are individually reasonable but collectively enormous stops
    // being pulled instead of being fully materialised and then trimmed.
    // (500 rows x 100KB used to allocate ~50MB before the cap applied.)
    for (const row of readonlyDb().prepare(guard.sql).iterate()) {
      const size = JSON.stringify(row).length + 1;
      if (size > budget) {
        truncated = true;
        break;
      }
      budget -= size;
      rows.push(row);
    }
  } catch (err) {
    // A malformed query is normal — the model should see the error and retry,
    // not have the request fail.
    return { ok: false, text: `SQL error: ${String((err as Error)?.message ?? err)}` };
  }
  const ms = Date.now() - started;

  let text = JSON.stringify(rows);
  if (truncated) text += `\n(truncated: result exceeded ${MAX_JSON_BYTES} bytes — aggregate in SQL)`;
  else if (rows.length === MAX_ROWS) {
    text += `\n(capped at ${MAX_ROWS} rows — aggregate in SQL if you need more)`;
  }

  return { ok: true, text, rowCount: rows.length, ms };
}
