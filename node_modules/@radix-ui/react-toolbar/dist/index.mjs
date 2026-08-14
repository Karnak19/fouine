"use client";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/toolbar.tsx
import * as React from "react";
import { composeEventHandlers } from "@radix-ui/primitive";
import { createContextScope } from "@radix-ui/react-context";
import * as RovingFocusGroup from "@radix-ui/react-roving-focus";
import { createRovingFocusGroupScope } from "@radix-ui/react-roving-focus";
import { Primitive } from "@radix-ui/react-primitive";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { createToggleGroupScope } from "@radix-ui/react-toggle-group";
import { useDirection } from "@radix-ui/react-direction";
import { jsx } from "react/jsx-runtime";
var TOOLBAR_NAME = "Toolbar";
var [createToolbarContext, createToolbarScope] = createContextScope(TOOLBAR_NAME, [
  createRovingFocusGroupScope,
  createToggleGroupScope
]);
var useRovingFocusGroupScope = createRovingFocusGroupScope();
var useToggleGroupScope = createToggleGroupScope();
var [ToolbarProvider, useToolbarContext] = createToolbarContext(TOOLBAR_NAME);
var Toolbar = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function Toolbar2(props, forwardedRef) {
    const { __scopeToolbar, orientation = "horizontal", dir, loop = true, ...toolbarProps } = props;
    const rovingFocusGroupScope = useRovingFocusGroupScope(__scopeToolbar);
    const direction = useDirection(dir);
    return /* @__PURE__ */ jsx(ToolbarProvider, { scope: __scopeToolbar, orientation, dir: direction, children: /* @__PURE__ */ jsx(
      RovingFocusGroup.Root,
      {
        asChild: true,
        ...rovingFocusGroupScope,
        orientation,
        dir: direction,
        loop,
        children: /* @__PURE__ */ jsx(
          Primitive.div,
          {
            role: "toolbar",
            "aria-orientation": orientation,
            dir: direction,
            ...toolbarProps,
            ref: forwardedRef
          }
        )
      }
    ) });
  }, "Toolbar")
);
var SEPARATOR_NAME = "ToolbarSeparator";
var ToolbarSeparator = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function ToolbarSeparator2(props, forwardedRef) {
    const { __scopeToolbar, ...separatorProps } = props;
    const context = useToolbarContext(SEPARATOR_NAME, __scopeToolbar);
    return /* @__PURE__ */ jsx(
      SeparatorPrimitive.Root,
      {
        orientation: context.orientation === "horizontal" ? "vertical" : "horizontal",
        ...separatorProps,
        ref: forwardedRef
      }
    );
  }, "ToolbarSeparator")
);
var ToolbarButton = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function ToolbarButton2(props, forwardedRef) {
    const { __scopeToolbar, ...buttonProps } = props;
    const rovingFocusGroupScope = useRovingFocusGroupScope(__scopeToolbar);
    return /* @__PURE__ */ jsx(RovingFocusGroup.Item, { asChild: true, ...rovingFocusGroupScope, focusable: !props.disabled, children: /* @__PURE__ */ jsx(Primitive.button, { type: "button", ...buttonProps, ref: forwardedRef }) });
  }, "ToolbarButton")
);
var ToolbarLink = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function ToolbarLink2(props, forwardedRef) {
    const { __scopeToolbar, ...linkProps } = props;
    const rovingFocusGroupScope = useRovingFocusGroupScope(__scopeToolbar);
    return /* @__PURE__ */ jsx(RovingFocusGroup.Item, { asChild: true, ...rovingFocusGroupScope, focusable: true, children: /* @__PURE__ */ jsx(
      Primitive.a,
      {
        ...linkProps,
        ref: forwardedRef,
        onKeyDown: composeEventHandlers(props.onKeyDown, (event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          if (event.key === " ") {
            event.currentTarget.click();
          }
        })
      }
    ) });
  }, "ToolbarLink")
);
var TOGGLE_GROUP_NAME = "ToolbarToggleGroup";
var ToolbarToggleGroup = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function ToolbarToggleGroup2(props, forwardedRef) {
    const { __scopeToolbar, ...toggleGroupProps } = props;
    const context = useToolbarContext(TOGGLE_GROUP_NAME, __scopeToolbar);
    const toggleGroupScope = useToggleGroupScope(__scopeToolbar);
    return /* @__PURE__ */ jsx(
      ToggleGroupPrimitive.Root,
      {
        "data-orientation": context.orientation,
        dir: context.dir,
        ...toggleGroupScope,
        ...toggleGroupProps,
        ref: forwardedRef,
        rovingFocus: false
      }
    );
  }, "ToolbarToggleGroup")
);
var ToolbarToggleItem = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function ToolbarToggleItem2(props, forwardedRef) {
    const { __scopeToolbar, ...toggleItemProps } = props;
    const toggleGroupScope = useToggleGroupScope(__scopeToolbar);
    const scope = { __scopeToolbar: props.__scopeToolbar };
    return /* @__PURE__ */ jsx(ToolbarButton, { asChild: true, ...scope, children: /* @__PURE__ */ jsx(ToggleGroupPrimitive.Item, { ...toggleGroupScope, ...toggleItemProps, ref: forwardedRef }) });
  }, "ToolbarToggleItem")
);
var Root4 = Toolbar;
var Separator = ToolbarSeparator;
var Button = ToolbarButton;
var Link = ToolbarLink;
var ToggleGroup = ToolbarToggleGroup;
var ToggleItem = ToolbarToggleItem;
export {
  Button,
  Link,
  Root4 as Root,
  Separator,
  ToggleGroup,
  ToggleItem,
  Toolbar,
  ToolbarButton,
  ToolbarLink,
  ToolbarSeparator,
  ToolbarToggleGroup,
  ToolbarToggleItem,
  createToolbarScope
};
//# sourceMappingURL=index.mjs.map
