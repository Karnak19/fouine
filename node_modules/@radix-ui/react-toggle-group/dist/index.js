"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  Item: () => ToggleGroupItem,
  Root: () => ToggleGroup,
  ToggleGroup: () => ToggleGroup,
  ToggleGroupItem: () => ToggleGroupItem,
  createToggleGroupScope: () => createToggleGroupScope
});
module.exports = __toCommonJS(index_exports);

// src/toggle-group.tsx
var React = __toESM(require("react"));
var import_react_context = require("@radix-ui/react-context");
var import_react_primitive = require("@radix-ui/react-primitive");
var RovingFocusGroup = __toESM(require("@radix-ui/react-roving-focus"));
var import_react_roving_focus = require("@radix-ui/react-roving-focus");
var import_react_toggle = require("@radix-ui/react-toggle");
var import_react_use_controllable_state = require("@radix-ui/react-use-controllable-state");
var import_react_direction = require("@radix-ui/react-direction");
var import_jsx_runtime = require("react/jsx-runtime");
var TOGGLE_GROUP_NAME = "ToggleGroup";
var [createToggleGroupContext, createToggleGroupScope] = (0, import_react_context.createContextScope)(TOGGLE_GROUP_NAME, [
  import_react_roving_focus.createRovingFocusGroupScope
]);
var useRovingFocusGroupScope = (0, import_react_roving_focus.createRovingFocusGroupScope)();
var ToggleGroup = /* @__PURE__ */ React.forwardRef(/* @__PURE__ */ __name(function ToggleGroup2(props, forwardedRef) {
  const { type, ...toggleGroupProps } = props;
  if (type === "single") {
    const singleProps = toggleGroupProps;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleGroupImplSingle, { role: "radiogroup", ...singleProps, ref: forwardedRef });
  }
  if (type === "multiple") {
    const multipleProps = toggleGroupProps;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleGroupImplMultiple, { role: "toolbar", ...multipleProps, ref: forwardedRef });
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
  const [value, setValue] = (0, import_react_use_controllable_state.useControllableState)({
    prop: valueProp,
    defaultProp: defaultValue ?? "",
    onChange: onValueChange,
    caller: TOGGLE_GROUP_NAME
  });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    ToggleGroupValueProvider,
    {
      scope: props.__scopeToggleGroup,
      type: "single",
      value: React.useMemo(() => value ? [value] : [], [value]),
      onItemActivate: setValue,
      onItemDeactivate: React.useCallback(() => setValue(""), [setValue]),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleGroupImpl, { ...toggleGroupSingleProps, ref: forwardedRef })
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
  const [value, setValue] = (0, import_react_use_controllable_state.useControllableState)({
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    ToggleGroupValueProvider,
    {
      scope: props.__scopeToggleGroup,
      type: "multiple",
      value,
      onItemActivate: handleButtonActivate,
      onItemDeactivate: handleButtonDeactivate,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleGroupImpl, { ...toggleGroupMultipleProps, ref: forwardedRef })
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
    const direction = (0, import_react_direction.useDirection)(dir);
    const commonProps = { dir: direction, ...toggleGroupProps };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleGroupContext, { scope: __scopeToggleGroup, rovingFocus, disabled, children: rovingFocus ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      RovingFocusGroup.Root,
      {
        asChild: true,
        ...rovingFocusGroupScope,
        orientation,
        dir: direction,
        loop,
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react_primitive.Primitive.div, { ...commonProps, ref: forwardedRef })
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react_primitive.Primitive.div, { ...commonProps, ref: forwardedRef }) });
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
    return context.rovingFocus ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      RovingFocusGroup.Item,
      {
        asChild: true,
        ...rovingFocusGroupScope,
        focusable: !disabled,
        active: pressed,
        ref,
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleGroupItemImpl, { ...commonProps, ref: forwardedRef })
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToggleGroupItemImpl, { ...commonProps, ref: forwardedRef });
  }, "ToggleGroupItem")
);
var ToggleGroupItemImpl = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function ToggleGroupItemImpl2(props, forwardedRef) {
    const { __scopeToggleGroup, value, ...itemProps } = props;
    const valueContext = useToggleGroupValueContext(ITEM_NAME, __scopeToggleGroup);
    const singleProps = { role: "radio", "aria-checked": props.pressed, "aria-pressed": void 0 };
    const typeProps = valueContext.type === "single" ? singleProps : void 0;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_react_toggle.Toggle,
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
//# sourceMappingURL=index.js.map
