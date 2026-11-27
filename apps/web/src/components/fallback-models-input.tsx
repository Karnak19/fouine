import { useRef } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { ModelInput } from "@/components/model-input";
import { Button } from "@/components/ui/button";

interface Props {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  // Shown under the list when it is empty, e.g. what an empty list falls back to.
  emptyHint?: string;
}

// An ordered list of fallback models (#185): one ModelInput per row, plus add,
// remove and move up/down. Order matters — when a model runs out of quota the
// review moves on to the next row.
//
// Each row gets a stable key that follows it when rows move, so a row's
// ModelInput keeps its own suggestions instead of inheriting its neighbour's.
// The keys live here, not in the value, so the parent only deals in plain
// strings. If the value changes from outside (hydrate, reset) and the lengths no
// longer match, the keys are simply rebuilt.
export function FallbackModelsInput({ id, value, onChange, emptyHint }: Props) {
  const nextKey = useRef(0);
  const keys = useRef<number[]>([]);
  if (keys.current.length !== value.length) {
    keys.current = value.map(() => nextKey.current++);
  }

  const update = (next: string[], nextKeys: number[]) => {
    keys.current = nextKeys;
    onChange(next);
  };

  const move = (from: number, to: number) => {
    const next = [...value];
    const nextKeys = [...keys.current];
    [next[from], next[to]] = [next[to]!, next[from]!];
    [nextKeys[from], nextKeys[to]] = [nextKeys[to]!, nextKeys[from]!];
    update(next, nextKeys);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && emptyHint && <p className="text-sm text-zinc-500">{emptyHint}</p>}
      <ol className="space-y-3">
        {value.map((spec, i) => (
          <li key={keys.current[i]} className="flex items-start gap-2">
            <span className="w-5 shrink-0 pt-2 text-right text-sm tabular-nums text-zinc-500">
              {i + 1}.
            </span>
            <div className="min-w-0 max-w-md flex-1 space-y-1.5">
              <ModelInput
                id={`${id}-${keys.current[i]}`}
                placeholder="provider/model"
                value={spec}
                onChange={(v) => {
                  const next = [...value];
                  next[i] = v;
                  update(next, keys.current);
                }}
              />
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move fallback ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move fallback ${i + 1} down`}
                disabled={i === value.length - 1}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove fallback ${i + 1}`}
                onClick={() =>
                  update(
                    value.filter((_, j) => j !== i),
                    keys.current.filter((_, j) => j !== i),
                  )
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => update([...value, ""], [...keys.current, nextKey.current++])}
      >
        <Plus className="h-4 w-4" />
        Add fallback model
      </Button>
    </div>
  );
}
