import { Store, StoreValue } from "nanostores";

//#region src/client/equality.d.ts
/**
 * Deep structural equality for JSON-serializable values.
 * Handles: primitives, null, arrays, and plain objects.
 * Short-circuits on referential equality at every recursion level.
 */
declare function isJsonEqual(a: unknown, b: unknown): boolean;
/**
 * Attach an equality gate to a nanostores atom via `onSet`.
 * When `isEqual(currentValue, newValue)` returns true, the `set()` call
 * is aborted: no listeners fire, no framework re-renders occur.
 *
 * Returns the unsubscribe function from `onSet`.
 */
declare function withEquality<S extends Store>(store: S, isEqual: (a: StoreValue<S>, b: StoreValue<S>) => boolean): () => void;
//#endregion
export { isJsonEqual, withEquality };