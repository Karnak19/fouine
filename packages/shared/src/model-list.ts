// An ordered list of "provider/model" specs, used for the fallback models
// (#185). Stored as a JSON array string, both in the global `fallback_models`
// setting and in `repos.fallback_models`. Shared because the server resolves it
// and the dashboard edits it, and both must agree on what a valid list is.

// Keep the entries that look like a model spec (a provider, a slash, a model),
// trimmed, in order, without duplicates. Anything else is dropped rather than
// rejected: a half-typed row in the dashboard must not block saving the rest.
export function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const spec = item.trim();
    const slash = spec.indexOf("/");
    if (slash <= 0 || slash === spec.length - 1) continue;
    if (!out.includes(spec)) out.push(spec);
  }
  return out;
}

// Parse a stored list. Missing, empty or broken JSON all mean "no list".
export function parseModelList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return normalizeModelList(JSON.parse(raw));
  } catch {
    return [];
  }
}
