// Categorical palettes. These stay raw `ember-*`/`sky-*`/`violet-*`/`amber-*`
// utilities rather than semantic tokens: there is no semantic token for "the
// third category", and the point of a categorical ramp is that hue N always
// means the same thing.
//
// Hues are assigned in a FIXED order — first series gets ember, second sky, and
// so on. Callers that index into this with `i % TRIGGER_COLORS.length` will
// silently reuse a hue once they run past the end, which makes two different
// categories look like the same one. Prefer keeping the first
// TRIGGER_COLORS.length - 1 categories and folding the rest into a single
// "Other" bucket painted with the last (zinc) entry.
export const TRIGGER_COLORS = [
  "bg-ember-400",
  "bg-sky-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-zinc-500",
];

// Same palette as the review view: blocking = alarm, question = ask, nit = muted.
export const SEVERITY_COLORS: Record<string, string> = {
  blocking: "bg-red-400",
  question: "bg-amber-400",
  nit: "bg-zinc-500",
};
