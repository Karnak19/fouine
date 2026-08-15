// One cell of a KPI strip: uppercase label over a big tabular-nums value.
// null value renders a skeleton; accent/pulse mark a live/running stat.
export function Stat({
  label,
  value,
  sub,
  accent,
  pulse,
}: {
  label: string;
  value: string | null;
  sub?: string;
  accent?: boolean;
  pulse?: boolean;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-zinc-500">
        {pulse && (
          <span className="h-1.5 w-1.5 rounded-full bg-ember-400 animate-[fouine-pulse_1.4s_ease-in-out_infinite]" />
        )}
        {label}
      </div>
      {value == null ? (
        <div className="mt-1.5 h-7 w-12 rounded bg-zinc-800/70 animate-pulse" />
      ) : (
        <div
          className={`mt-0.5 text-2xl font-semibold tabular-nums ${accent ? "text-ember-300" : "text-zinc-100"}`}
        >
          {value}
        </div>
      )}
      {sub && <div className="text-xs text-zinc-500 tabular-nums">{sub}</div>}
    </div>
  );
}
