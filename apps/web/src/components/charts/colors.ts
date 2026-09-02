import * as stylex from "@stylexjs/stylex";
import { color } from "@/tokens.stylex";

// Categorical palettes. These stay a fixed ramp rather than semantic tokens:
// there is no semantic token for "the third category", and the point of a
// categorical ramp is that hue N always means the same thing.
//
// Hues are assigned in a FIXED order — first series gets ember, second sky, and
// so on. Callers that index into this with `i % TRIGGER_COLORS.length` will
// silently reuse a hue once they run past the end, which makes two different
// categories look like the same one. Prefer keeping the first
// TRIGGER_COLORS.length - 1 categories and folding the rest into a single
// "Other" bucket painted with the last (zinc) entry.
// The order is load-bearing, not cosmetic. Adjacent entries land next to each
// other in a stacked bar, and violet-400 against sky-400 is ΔE 5.7 under
// deuteranopia — indistinguishable for a red-green colourblind reader, below
// even the 6–8 band that secondary encoding can rescue. Moving amber between
// them takes the worst adjacent pair to 19.7. Re-run the check before
// reordering again:
//   node <dataviz skill>/scripts/validate_palette.js \
//     "#f59740,#00bcff,#ffb900,#a684ff,#7d7a76" --mode dark --surface "#100d0a"
//
// cat1..cat5 in tokens.stylex.ts hold the ramp in that order; renaming or
// reordering there reorders every chart at once.
const cat = stylex.create({
  c1: { backgroundColor: color.cat1 },
  c2: { backgroundColor: color.cat2 },
  c3: { backgroundColor: color.cat3 },
  c4: { backgroundColor: color.cat4 },
  c5: { backgroundColor: color.cat5 },
});

export const TRIGGER_COLORS = [cat.c1, cat.c2, cat.c3, cat.c4, cat.c5];

// Same palette as the review view: blocking = alarm, question = ask, nit = muted.
const sev = stylex.create({
  blocking: { backgroundColor: color.dangerDot },
  question: { backgroundColor: color.warnDot },
  nit: { backgroundColor: color.cat5 },
});

export const SEVERITY_COLORS: Record<string, stylex.StyleXStyles> = {
  blocking: sev.blocking,
  question: sev.question,
  nit: sev.nit,
};

// Fallback for an unknown severity — callers previously defaulted to a
// zinc utility string.
export const UNKNOWN_SEVERITY_COLOR: stylex.StyleXStyles = sev.nit;
