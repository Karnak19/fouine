import { useEffect, useRef } from "react";
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
//
// Keyboard focus: moving a row to an end disables the button you pressed, and
// removing a row unmounts it — either way the browser drops focus to <body>, and
// the next Shift+Tab can land on an unrelated "Remove". So after a move or a
// remove we say where focus should go next (by row key, which survives the
// reorder) and put it there once React has rendered.
type FocusTarget = { key: number; control: "up" | "down" | "remove" } | "add";

export function FallbackModelsInput({ id, value, onChange, emptyHint }: Props) {
  const nextKey = useRef(0);
  const keys = useRef<number[]>([]);
  if (keys.current.length !== value.length) {
    keys.current = value.map(() => nextKey.current++);
  }

  const controls = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const controlRef = (key: number, control: "up" | "down" | "remove") => (el: HTMLButtonElement | null) => {
    if (el) controls.current.set(`${key}-${control}`, el);
    else controls.current.delete(`${key}-${control}`);
  };

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === "add") addButton.current?.focus();
    else controls.current.get(`${target.key}-${target.control}`)?.focus();
  });

  const update = (next: string[], nextKeys: number[]) => {
    keys.current = nextKeys;
    onChange(next);
  };

  const move = (from: number, to: number) => {
    const next = [...value];
    const nextKeys = [...keys.current];
    [next[from], next[to]] = [next[to]!, next[from]!];
    [nextKeys[from], nextKeys[to]] = [nextKeys[to]!, nextKeys[from]!];
    // Stay on the button just pressed, unless the row reached an end and that
    // button is now disabled — then hop to the row's other move button.
    const up = to < from;
    const atEnd = up ? to === 0 : to === value.length - 1;
    pendingFocus.current = {
      key: keys.current[from]!,
      control: up !== atEnd ? "up" : "down",
    };
    update(next, nextKeys);
  };

  const remove = (i: number) => {
    // The row that slides into this slot, else the one above, else "Add".
    const neighbour = keys.current[i + 1] ?? keys.current[i - 1];
    pendingFocus.current = neighbour === undefined ? "add" : { key: neighbour, control: "remove" };
    update(
      value.filter((_, j) => j !== i),
      keys.current.filter((_, j) => j !== i),
    );
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && emptyHint && <p className="text-sm text-zinc-500">{emptyHint}</p>}
      <ol className="space-y-3">
        {value.map((spec, i) => (
          // On a phone the move/remove buttons drop under the input (indented past
          // the row number) so the input gets the full width for long model ids.
          <li key={keys.current[i]} className="flex flex-wrap items-start gap-x-2 gap-y-1 sm:flex-nowrap">
            <span className="w-5 shrink-0 pt-2 text-right text-sm tabular-nums text-zinc-500">
              {i + 1}.
            </span>
            <div className="min-w-0 shrink grow basis-[calc(100%-1.75rem)] space-y-1.5 sm:max-w-md sm:basis-0">
              <label htmlFor={`${id}-${keys.current[i]}`} className="sr-only">
                Fallback model {i + 1}
              </label>
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
            <div className="ml-7 flex shrink-0 gap-1 sm:ml-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                ref={controlRef(keys.current[i]!, "up")}
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
                ref={controlRef(keys.current[i]!, "down")}
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
                ref={controlRef(keys.current[i]!, "remove")}
                aria-label={`Remove fallback ${i + 1}`}
                onClick={() => remove(i)}
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
        ref={addButton}
        onClick={() => update([...value, ""], [...keys.current, nextKey.current++])}
      >
        <Plus className="h-4 w-4" />
        Add fallback model
      </Button>
    </div>
  );
}
