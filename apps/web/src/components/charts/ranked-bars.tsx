import type { ReactNode } from "react";

// A ranking of named things as a list: each row prints its name and value in
// full, and a thin bar under it shows the value against the largest one. A
// list rather than a Recharts bar chart because the names are the point —
// repo slugs and model ids are long, an axis label truncates them to `ope…`,
// and every row may need to be a link. Plain divs: there is no axis to draw.
//
// Rows are drawn largest first whatever order they arrive in. The value is
// always printed, so the bar is a reading aid, never the only way to get the
// number.

export interface RankedBarRow {
  key: string;
  /** The name, in full; the row truncates it and shows `title` on hover. */
  label: ReactNode;
  title: string;
  /** A quieter line under the name — a PR title, say. */
  sub?: ReactNode;
  /** Secondary numbers, quietest of all: "18 reviews · 6m 32s". */
  meta?: ReactNode;
  value: number;
  valueLabel: string;
  /** Wraps the whole row, e.g. in a router Link. Gets the row's classes. */
  wrap?: (children: ReactNode, className: string) => ReactNode;
}

const ROW = "block px-4 py-2.5";

export function RankedBars({ rows, footer }: { rows: RankedBarRow[]; footer?: ReactNode }) {
  const ranked = [...rows].sort((a, b) => b.value - a.value);
  const max = Math.max(...ranked.map((r) => r.value), 0);
  return (
    <div>
      <ul className="divide-y divide-zinc-800/70">
        {ranked.map((r) => {
          const body = (
            <>
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200" title={r.title}>
                  {r.label}
                </span>
                <span className="shrink-0 text-sm text-zinc-100 tabular-nums">{r.valueLabel}</span>
              </div>
              {r.sub && <div className="truncate text-xs text-zinc-400">{r.sub}</div>}
              {/* The track is the scale: a full bar is the largest row. A non-zero
                  value never draws thinner than a sliver, so it doesn't read as 0. */}
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800/80">
                <div
                  className="h-full rounded-full bg-ember-500/70"
                  style={{ width: max > 0 && r.value > 0 ? `max(2px, ${(r.value / max) * 100}%)` : 0 }}
                />
              </div>
              {r.meta && <div className="mt-1 truncate text-xs text-zinc-500 tabular-nums">{r.meta}</div>}
            </>
          );
          return (
            <li key={r.key}>
              {r.wrap ? r.wrap(body, `${ROW} transition-colors hover:bg-zinc-800/40`) : <div className={ROW}>{body}</div>}
            </li>
          );
        })}
      </ul>
      {footer && (
        <div className="flex items-baseline gap-3 border-t border-zinc-800 px-4 py-2.5">{footer}</div>
      )}
    </div>
  );
}
