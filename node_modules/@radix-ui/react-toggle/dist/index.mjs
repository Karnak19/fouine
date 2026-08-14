"use client";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/toggle.tsx
import * as React from "react";
import { composeEventHandlers } from "@radix-ui/primitive";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { Primitive } from "@radix-ui/react-primitive";
import { jsx } from "react/jsx-runtime";
var NAME = "Toggle";
var Toggle = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function Toggle2(props, forwardedRef) {
    const { pressed: pressedProp, defaultPressed, onPressedChange, ...buttonProps } = props;
    const [pressed, setPressed] = useControllableState({
      prop: pressedProp,
      onChange: onPressedChange,
      defaultProp: defaultPressed ?? false,
      caller: NAME
    });
    return /* @__PURE__ */ jsx(
      Primitive.button,
      {
        type: "button",
        "aria-pressed": pressed,
        "data-state": pressed ? "on" : "off",
        "data-disabled": props.disabled ? "" : void 0,
        ...buttonProps,
        ref: forwardedRef,
        onClick: composeEventHandlers(props.onClick, () => {
          if (!props.disabled) {
            setPressed(!pressed);
          }
        })
      }
    );
  }, "Toggle")
);
var Root = Toggle;
export {
  Root,
  Toggle
};
//# sourceMappingURL=index.mjs.map
