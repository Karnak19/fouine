import { config } from "~/config";
// Imported for the side effect: src/db.ts owns the read/write handle that
// creates the file and the schema. A readonly connection cannot create either,
// so it must not be the first to open the path.
import "~/db";

// Queries run in a worker (src/chat/query-worker.ts) against a readonly
// connection it opens itself. Readonly is still the primary guard — a write
// throws in the driver, not in a regex we have to get right — and the worker
// adds the one thing an in-process query cannot have: a deadline. bun:sqlite is
// synchronous with no interrupt, so a runaway query on this thread would block
// the whole server.
function runInWorker(
  sql: string,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  rows?: unknown[];
  truncated?: boolean;
  error?: string;
}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./query-worker.ts", import.meta.url).href);
    const timer = setTimeout(() => {
      cleanup();
      worker.terminate();
      reject(
        new Error(
          `Query timed out after ${QUERY_TIMEOUT_MS}ms — it is doing too much work. Aggregate in SQL, or narrow the window.`,
        ),
      );
    }, QUERY_TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      cleanup();
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timer);
      cleanup();
      worker.terminate();
      reject(new Error(`query worker failed: ${e.message}`));
    };

    // A client that hangs up should not leave SQL grinding for nobody. The
    // worker is killed immediately rather than left to run out its deadline.
    const onAbort = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("query aborted"));
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ sql, dbPath: config.dbPath, maxBytes: MAX_JSON_BYTES });
  });
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

// A query that returns almost nothing can still run forever: `SELECT count(*)`
// over a runaway recursive CTE returns one row and never terminates. Row and
// byte caps bound the OUTPUT; only a deadline bounds the WORK.
export const QUERY_TIMEOUT_MS = 5_000;

export async function runStatsQuery(raw: string, signal?: AbortSignal): Promise<QueryOutcome> {
  const guard = guardQuery(raw);
  if (!guard.ok) return { ok: false, text: `Query rejected: ${guard.reason}` };

  const started = Date.now();
  let result: { ok: boolean; rows?: unknown[]; truncated?: boolean; error?: string };
  try {
    result = await runInWorker(guard.sql, signal);
  } catch (err) {
    return { ok: false, text: String((err as Error)?.message ?? err) };
  }
  if (!result.ok) {
    // A malformed query is normal — the model should see the error and retry,
    // not have the request fail.
    return { ok: false, text: `SQL error: ${result.error}` };
  }
  const rows = result.rows ?? [];
  const truncated = result.truncated ?? false;
  const ms = Date.now() - started;

  let text = JSON.stringify(rows);
  if (truncated) text += `\n(truncated: result exceeded ${MAX_JSON_BYTES} bytes — aggregate in SQL)`;
  else if (rows.length === MAX_ROWS) {
    text += `\n(capped at ${MAX_ROWS} rows — aggregate in SQL if you need more)`;
  }

  return { ok: true, text, rowCount: rows.length, ms };
}
