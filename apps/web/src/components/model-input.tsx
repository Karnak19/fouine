import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// A native datalist autocomplete rather than a hard <select>: the catalog can be
// stale or unreachable (opencode missing, models.dev down), and opencode also
// accepts locally-configured models fouine never sees — so an unknown spec must
// stay typeable. The list is a suggestion, not a constraint.
//
// Suggestions are fetched per query rather than up front because the full
// models.dev catalog is ~5.5k entries / ~1MB. The server holds it in memory and
// filters, so each of these is a cheap round-trip; results are cached by query.
export function ModelInput({ id, value, onChange, placeholder }: Props) {
  const [debounced, setDebounced] = useState(value);
  // Suggestions are scoped to providers fouine has a key for. Opting out is for
  // the case where you're about to add a key and want to pre-fill the model.
  const [all, setAll] = useState(false);
  const listId = `${id}-models`;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 150);
    return () => clearTimeout(t);
  }, [value]);

  const { data } = useQuery({
    queryKey: ["models", debounced.trim(), all],
    queryFn: () => api.models.search(debounced.trim(), all),
    // Keep the previous suggestions on screen while the next query resolves —
    // an empty datalist mid-keystroke reads as "no such model".
    placeholderData: keepPreviousData,
    staleTime: 30 * 60 * 1000,
  });

  return (
    <>
      <Input
        id={id}
        list={listId}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {(data?.models ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.providerName} · {m.modelName}
            {m.configured ? "" : " (no key configured)"}
          </option>
        ))}
      </datalist>
      <p className="text-xs text-zinc-500">
        {all
          ? `Every provider on models.dev (${data?.total ?? 0} models).`
          : `${data?.providers.join(", ") || "No provider configured"} — ${data?.total ?? 0} models.`}{" "}
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 underline hover:bg-transparent hover:text-zinc-300"
          onClick={() => setAll(!all)}
        >
          {all ? "Only configured providers" : "Show all providers"}
        </Button>
      </p>
    </>
  );
}
