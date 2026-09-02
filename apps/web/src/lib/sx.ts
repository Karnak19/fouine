import type * as stylex from "@stylexjs/stylex";

// StyleX 0.19 types a style whose property is keyed on an ARBITRARY attribute
// selector (`'[data-state="open"]'`, `'[data-selected="true"]'`) as
// `StyleXClassNameFor<Prop, unknown>`. No `StyleXStyles` annotation accepts
// that: the brand sits on the value type, so widening the parameter doesn't
// help. Tested and rejected — `StyleXStyles`, `StyleXStyles<any>`,
// `StaticStyles`, `StyleXStyles<Record<string, {} | null>>`, and a mapped
// `{ [K in keyof CSSProperties]: unknown }` (which fails the
// `UserAuthoredStyles` constraint outright).
//
// Recognised pseudo keys (`:hover`, `:disabled`, even `:has(:focus)`) keep
// their real value type and need none of this.
//
// So a style like that needs one cast to cross a component prop boundary. This
// is that cast, in one place, rather than an `as` at every call site.
// ponytail: delete this the day StyleX types attribute-selector styles
// properly — the call sites then just work.
export const attrStyle = <T>(style: T): stylex.StyleXStyles => style as stylex.StyleXStyles;
