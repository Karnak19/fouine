import type * as stylex from "@stylexjs/stylex";

// A style whose property is keyed on an ARBITRARY attribute selector
// (`'[data-state="open"]'`, `'[data-selected="true"]'`) compiles to
// `StyleXClassNameFor<Prop, unknown>` in StyleX 0.19, and no annotation accepts
// that across a prop boundary — the brand sits on the value type, so widening
// the parameter cannot help. Tested and rejected: `StyleXStyles`,
// `StyleXStyles<any>`, `StaticStyles`, `StyleXStyles<Record<string, {} | null>>`,
// and a mapped `{ [K in keyof CSSProperties]: unknown }` (fails the
// `UserAuthoredStyles` constraint outright). Recognised pseudo keys (`:hover`,
// `:disabled`, `:has(:focus)`) keep their real value type and need none of this.
// ponytail: one audited cast, not an `as` at each call site. Delete when StyleX
// types these properly — the call sites then just work.
export const attrStyle = <T>(style: T): stylex.StyleXStyles => style as stylex.StyleXStyles;
