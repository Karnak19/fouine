import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

// Panel chrome plus the two non-chart states. A panel always renders one of
// three things — PanelSkeleton while the data is undefined, PanelEmpty when it
// came back with no rows, the chart otherwise — because an empty window is a
// normal answer and must not look like a broken chart.

export function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  // min-w-0: grid/flex children default to min-width:auto, which makes a panel
  // expand to its widest table instead of letting that table scroll inside its
  // own overflow-x box — which on a phone pushes the whole page sideways. Every
  // grid wrapper around a panel carries min-w-0 for the same reason.
  return (
    <section className={`flex min-w-0 flex-col space-y-2.5 ${className ?? ""}`}>
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h2>
      {/* Deliberately a block, not a flex column: as a flex parent its children
          become flex items with min-width:auto, which lets a wide table grow
          past the panel instead of scrolling inside its own overflow-x box —
          the table then gets clipped by overflow-hidden and is unreachable on
          a phone. A chart gets its height from its own h-40/h-32, not from
          this. */}
      <div className="flex-1 rounded-lg border border-border bg-card/40 overflow-hidden">
        {children}
      </div>
    </section>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 px-4 py-3.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-muted/70 animate-pulse motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function PanelEmpty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Inbox size={18} className="text-zinc-700" />
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xs text-zinc-500">Try a wider range or fewer filters.</p>
    </div>
  );
}
