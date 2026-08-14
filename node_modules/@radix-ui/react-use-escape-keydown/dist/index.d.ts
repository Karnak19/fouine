/**
 * Listens for when the escape key is down
 *
 * @deprecated Attach listeners directly via useEffect for more granular control
 * over how callbacks are stabilized, when to detach listeners, etc.
 */
declare function useEscapeKeydown(onEscapeKeyDownProp?: (event: KeyboardEvent) => void, ownerDocument?: Document): void;

export { useEscapeKeydown };
