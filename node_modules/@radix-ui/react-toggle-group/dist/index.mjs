"use client";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/toggle-group.tsx
import * as React from "react";
import { createContextScope } from "@radix-ui/react-context";
import { Primitive } from "@radix-ui/react-primitive";
import * as RovingFocusGroup from "@radix-ui/react-roving-focus";
import { createRovingFocusGroupScope } from "@radix-ui/react-roving-focus";
import { Toggle } from "@radix-ui/react-toggle";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { useDirection } from "@radix-ui/react-direction";
import { jsx } from "react/jsx-runtime";
var TOGGLE_GROUP_NAME = "ToggleGroup";
var [createToggleGroupContext, createToggleGroupScope] = createContextScope(TOGGLE_GROUP_NAME, [
  createRovingFocusGroupScope
]);
var useRovingFocusGroupScope = createRovingFocusGroupScope();
var ToggleGroup = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function ToggleGroup2(props, forwardedRef) {
  const { type, ...toggleGroupProps } = props;
  if (type === "single") {
    const singleProps = toggleGroupProps;
    return /* @__PURE__ */ jsx(ToggleGroupImplSingle, { role: "radiogroup", ...singleProps, ref: forwardedRef });
  }
  if (type === "multiple") {
    const multipleProps = toggleGroupProps;
    return /* @__PURE__ */ jsx(ToggleGroupImplMultiple, { role: "toolbar", ...multipleProps, ref: forwardedRef });
  }
  throw new Error(`Missing prop \`type\` expected on \`${TOGGLE_GROUP_NAME}\``);
}, "ToggleGroup"));
var [ToggleGroupValueProvider, useToggleGroupValueContext] = createToggleGroupContext(TOGGLE_GROUP_NAME);
var ToggleGroupImplSingle = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function ToggleGroupImplSingle2(props, forwardedRef) {
  const {
    value: valueProp,
    defaultValue,
    onValueChange = /* @__PURE__ */ __name(() => {
    }, "onValueChange"),
    ...toggleGroupSingleProps
  } = props;
  const [value, setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue ?? "",
    onChange: onValueChange,
    caller: TOGGLE_GROUP_NAME
  });
  return /* @__PURE__ */ jsx(
    ToggleGroupValueProvider,
    {
      scope: props.__scopeToggleGroup,
      type: "single",
      value: React.useMemo(() => value ? [value] : [], [value]),
      onItemActivate: setValue,
      onItemDeactivate: React.useCallback(() => setValue(""), [setValue]),
      children: /* @__PURE__ */ jsx(ToggleGroupImpl, { ...toggleGroupSingleProps, ref: forwardedRef })
    }
  );
}, "ToggleGroupImplSingle"));
var ToggleGroupImplMultiple = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function ToggleGroupImplMultiple2(props, forwardedRef) {
  const {
    value: valueProp,
    defaultValue,
    onValueChange = /* @__PURE__ */ __name(() => {
    }, "onValueChange"),
    ...toggleGroupMultipleProps
  } = props;
  const [value, setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue ?? [],
    onChange: onValueChange,
    caller: TOGGLE_GROUP_NAME
  });
  const handleButtonActivate = React.useCallback(
    (itemValue) => setValue((prevValue = []) => [...prevValue, itemValue]),
    [setValue]
  );
  const handleButtonDeactivate = React.useCallback(
    (itemValue) => setValue((prevValue = []) => prevValue.filter((value2) => value2 !== itemValue)),
    [setValue]
  );
  return /* @__PURE__ */ jsx(
    ToggleGroupValueProvider,
    {
      scope: props.__scopeToggleGroup,
      type: "multiple",
      value,
      onItemActivate: handleButtonActivate,
      onItemDeactivate: handleButtonDeactivate,
      children: /* @__PURE__ */ jsx(ToggleGroupImpl, { ...toggleGroupMultipleProps, ref: forwardedRef })
    }
  );
}, "ToggleGroupImplMultiple"));
var [ToggleGroupContext, useToggleGroupContext] = createToggleGroupContext(TOGGLE_GROUP_NAME);
var ToggleGroupImpl = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function ToggleGroupImpl2(props, forwardedRef) {
    const {
      __scopeToggleGroup,
      disabled = false,
      rovingFocus = true,
      orientation,
      dir,
      loop = true,
      ...toggleGroupProps
    } = props;
    const rovingFocusGroupScope = useRovingFocusGroupScope(__scopeToggleGroup);
    const direction = useDirection(dir);
    const commonProps = { dir: direction, ...toggleGroupProps };
    return /* @__PURE__ */ jsx(ToggleGroupContext, { scope: __scopeToggleGroup, rovingFocus, disabled, children: rovingFocus ? /* @__PURE__ */ jsx(
      RovingFocusGroup.Root,
      {
        asChild: true,
        ...rovingFocusGroupScope,
        orientation,
        dir: direction,
        loop,
        children: /* @__PURE__ */ jsx(Primitive.div, { ...commonProps, ref: forwardedRef })
      }
    ) : /* @__PURE__ */ jsx(Primitive.div, { ...commonProps, ref: forwardedRef }) });
  }, "ToggleGroupImpl")
);
var ITEM_NAME = "ToggleGroupItem";
var ToggleGroupItem = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function ToggleGroupItem2(props, forwardedRef) {
    const valueContext = useToggleGroupValueContext(ITEM_NAME, props.__scopeToggleGroup);
    const context = useToggleGroupContext(ITEM_NAME, props.__scopeToggleGroup);
    const rovingFocusGroupScope = useRovingFocusGroupScope(props.__scopeToggleGroup);
    const pressed = valueContext.value.includes(props.value);
    const disabled = context.disabled || props.disabled;
    const commonProps = { ...props, pressed, disabled };
    const ref = React.useRef(null);
    return context.rovingFocus ? /* @__PURE__ */ jsx(
      RovingFocusGroup.Item,
      {
        asChild: true,
        ...rovingFocusGroupScope,
        focusable: !disabled,
        active: pressed,
        ref,
        children: /* @__PURE__ */ jsx(ToggleGroupItemImpl, { ...commonProps, ref: forwardedRef })
      }
    ) : /* @__PURE__ */ jsx(ToggleGroupItemImpl, { ...commonProps, ref: forwardedRef });
  }, "ToggleGroupItem")
);
var ToggleGroupItemImpl = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function ToggleGroupItemImpl2(props, forwardedRef) {
    const { __scopeToggleGroup, value, ...itemProps } = props;
    const valueContext = useToggleGroupValueContext(ITEM_NAME, __scopeToggleGroup);
    const singleProps = { role: "radio", "aria-checked": props.pressed, "aria-pressed": void 0 };
    const typeProps = valueContext.type === "single" ? singleProps : void 0;
    return /* @__PURE__ */ jsx(
      Toggle,
      {
        ...typeProps,
        ...itemProps,
        ref: forwardedRef,
        onPressedChange: (pressed) => {
          if (pressed) {
            valueContext.onItemActivate(value);
          } else {
            valueContext.onItemDeactivate(value);
          }
        }
      }
    );
  }, "ToggleGroupItemImpl")
);
export {
  ToggleGroupItem as Item,
  ToggleGroup as Root,
  ToggleGroup,
  ToggleGroupItem,
  createToggleGroupScope
};
//# sourceMappingURL=index.mjs.map
