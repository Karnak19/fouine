export interface MixBarItem {
  key: string;
  label: string;
  count: number;
  color: string;
}

// A 100% stacked horizontal bar with its own legend underneath. Good for "what
// is this made of" with a handful of categories; it says nothing about
// magnitude, so pair it with a count in the legend.
export function MixBar({ items }: { items: MixBarItem[] }) {
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="px-4 py-3.5 space-y-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {items.map((i) => (
          <div
            key={i.key}
            className={i.color}
            style={{ width: `${(i.count / total) * 100}%` }}
            // Native title=, not a Radix tooltip: it works on the bare div, it
            // costs nothing, and the segments are too thin to hang a portal on.
            title={`${i.label}: ${i.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {items.map((i) => (
          <span key={i.key} className="flex items-center gap-1.5 tabular-nums">
            <span className={`h-2 w-2 rounded-full ${i.color}`} />
            {i.label}
            <span className="text-zinc-500">{i.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
