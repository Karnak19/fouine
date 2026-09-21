import { formatValue } from "./from-rows";

// Labels under the bars while there is room for them; past that they collide
// into a grey smear and the endpoints caption says more. Same rule, and the
// same number, in the chat thread's chart card and the /build registry.
export const LABELS_FIT = 12;

// No axes anywhere in this app. What replaces them: a label per category while
// they still fit, and past that the two endpoints with the peak between them.
export function CategoryAxis({ cats, peak }: { cats: string[]; peak?: number }) {
  if (cats.length <= LABELS_FIT) {
    return (
      <div className="text-muted-foreground mt-2 flex gap-1 text-[0.7rem]">
        {cats.map((c) => (
          <span key={c} className="min-w-0 flex-1 truncate text-center" title={c}>
            {c}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="text-muted-foreground mt-2 flex justify-between gap-2 text-[0.7rem] tabular-nums">
      <span className="truncate">{cats[0]}</span>
      {peak !== undefined && <span className="shrink-0">{formatValue(peak)} peak</span>}
      <span className="truncate">{cats[cats.length - 1]}</span>
    </div>
  );
}
