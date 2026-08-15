// Runs one guarded query off the main thread so it can be KILLED.
//
// bun:sqlite is synchronous and exposes neither sqlite3_interrupt nor a progress
// handler, so a query that does unbounded work — `SELECT count(*)` over a
// runaway recursive CTE is the cheap example, and it hangs forever — cannot be
// cancelled in-process. It would block the event loop and take the whole
// dashboard down with it. Running it in a worker means the parent can
// terminate() it on a deadline.
//
// The worker receives ALREADY-GUARDED sql (guardQuery ran in the parent) and
// re-opens its own readonly connection: workers do not share handles.
import { Database } from "bun:sqlite";

declare const self: Worker;

interface Job {
  sql: string;
  dbPath: string;
  maxBytes: number;
}

self.onmessage = (event: MessageEvent<Job>) => {
  const { sql, dbPath, maxBytes } = event.data;
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows: unknown[] = [];
    let budget = maxBytes;
    let truncated = false;
    for (const row of db.prepare(sql).iterate()) {
      const size = JSON.stringify(row).length + 1;
      if (size > budget) {
        truncated = true;
        break;
      }
      budget -= size;
      rows.push(row);
    }
    db.close();
    self.postMessage({ ok: true, rows, truncated });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
