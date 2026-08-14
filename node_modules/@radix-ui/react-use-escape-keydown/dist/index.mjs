var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/use-escape-keydown.tsx
import * as React from "react";
import { useCallbackRef } from "@radix-ui/react-use-callback-ref";
function useEscapeKeydown(onEscapeKeyDownProp, ownerDocument = globalThis?.document) {
  const onEscapeKeyDown = useCallbackRef(onEscapeKeyDownProp);
  React.useEffect(() => {
    const handleKeyDown = /* @__PURE__ */ __name((event) => {
      if (event.key === "Escape") {
        onEscapeKeyDown(event);
      }
    }, "handleKeyDown");
    ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => ownerDocument.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onEscapeKeyDown, ownerDocument]);
}
__name(useEscapeKeydown, "useEscapeKeydown");
export {
  useEscapeKeydown
};
//# sourceMappingURL=index.mjs.map
