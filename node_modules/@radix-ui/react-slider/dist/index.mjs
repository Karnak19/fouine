"use client";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/slider.tsx
import * as React from "react";
import { clamp } from "@radix-ui/number";
import { composeEventHandlers } from "@radix-ui/primitive";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { createContextScope } from "@radix-ui/react-context";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { useDirection } from "@radix-ui/react-direction";
import { usePrevious } from "@radix-ui/react-use-previous";
import { useSize } from "@radix-ui/react-use-size";
import { Primitive } from "@radix-ui/react-primitive";
import { createCollection } from "@radix-ui/react-collection";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var PAGE_KEYS = ["PageUp", "PageDown"];
var ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
var BACK_KEYS = {
  "from-left": ["Home", "PageDown", "ArrowDown", "ArrowLeft"],
  "from-right": ["Home", "PageDown", "ArrowDown", "ArrowRight"],
  "from-bottom": ["Home", "PageDown", "ArrowDown", "ArrowLeft"],
  "from-top": ["Home", "PageDown", "ArrowUp", "ArrowLeft"]
};
var SLIDER_NAME = "Slider";
var [Collection, useCollection, createCollectionScope] = createCollection(SLIDER_NAME);
var [createSliderContext, createSliderScope] = createContextScope(SLIDER_NAME, [
  createCollectionScope
]);
var [SliderProvider, useSliderContext] = createSliderContext(SLIDER_NAME);
var Slider = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function Slider2(props, forwardedRef) {
    const {
      name,
      min = 0,
      max = 100,
      step = 1,
      orientation = "horizontal",
      disabled = false,
      minStepsBetweenThumbs = 0,
      defaultValue = [min],
      value,
      onValueChange = /* @__PURE__ */ __name(() => {
      }, "onValueChange"),
      onValueCommit = /* @__PURE__ */ __name(() => {
      }, "onValueCommit"),
      inverted = false,
      form,
      ...sliderProps
    } = props;
    const thumbRefs = React.useRef(/* @__PURE__ */ new Set());
    const valueIndexToChangeRef = React.useRef(0);
    const isKeyboardInteractionRef = React.useRef(false);
    const isHorizontal = orientation === "horizontal";
    const SliderOrientation = isHorizontal ? SliderHorizontal : SliderVertical;
    const [control, setControl] = React.useState(null);
    const composedRefs = useComposedRefs(forwardedRef, setControl);
    const [values = [], setValues] = useControllableState({
      prop: value,
      defaultProp: defaultValue,
      onChange: /* @__PURE__ */ __name((value2) => {
        const thumbs = [...thumbRefs.current];
        thumbs[valueIndexToChangeRef.current]?.focus({
          preventScroll: true,
          focusVisible: isKeyboardInteractionRef.current
        });
        isKeyboardInteractionRef.current = false;
        onValueChange(value2);
      }, "onChange")
    });
    const valuesBeforeSlideStartRef = React.useRef(values);
    const initialValuesRef = React.useRef(values);
    React.useEffect(() => {
      const associatedForm = form ? control?.ownerDocument.getElementById(form) : control?.closest("form");
      if (associatedForm instanceof HTMLFormElement) {
        const reset = /* @__PURE__ */ __name(() => setValues(initialValuesRef.current), "reset");
        associatedForm.addEventListener("reset", reset);
        return () => associatedForm.removeEventListener("reset", reset);
      }
    }, [control, form, setValues]);
    function handleSlideStart(value2) {
      const closestIndex = getClosestValueIndex(values, value2);
      updateValues(value2, closestIndex);
    }
    __name(handleSlideStart, "handleSlideStart");
    function handleSlideMove(value2) {
      updateValues(value2, valueIndexToChangeRef.current);
    }
    __name(handleSlideMove, "handleSlideMove");
    function handleSlideEnd() {
      const hasChanged = String(values) !== String(valuesBeforeSlideStartRef.current);
      if (hasChanged) onValueCommit(values);
    }
    __name(handleSlideEnd, "handleSlideEnd");
    function updateValues(value2, atIndex, { commit } = { commit: false }) {
      const decimalCount = getDecimalCount(step);
      const snapToStep = roundValue(Math.round((value2 - min) / step) * step + min, decimalCount);
      const nextValue = clamp(snapToStep, [min, max]);
      setValues((prevValues = []) => {
        const nextValues = getNextSortedValues(prevValues, nextValue, atIndex);
        if (hasMinStepsBetweenValues(nextValues, minStepsBetweenThumbs * step)) {
          valueIndexToChangeRef.current = nextValues.indexOf(nextValue);
          const hasChanged = String(nextValues) !== String(prevValues);
          if (hasChanged && commit) onValueCommit(nextValues);
          return hasChanged ? nextValues : prevValues;
        } else {
          return prevValues;
        }
      });
    }
    __name(updateValues, "updateValues");
    return /* @__PURE__ */ jsx(
      SliderProvider,
      {
        scope: props.__scopeSlider,
        name,
        disabled,
        min,
        max,
        valueIndexToChangeRef,
        thumbs: thumbRefs.current,
        values,
        orientation,
        form,
        children: /* @__PURE__ */ jsx(Collection.Provider, { scope: props.__scopeSlider, children: /* @__PURE__ */ jsx(Collection.Slot, { scope: props.__scopeSlider, children: /* @__PURE__ */ jsx(
          SliderOrientation,
          {
            "aria-disabled": disabled,
            "data-disabled": disabled ? "" : void 0,
            ...sliderProps,
            ref: composedRefs,
            onPointerDown: composeEventHandlers(sliderProps.onPointerDown, () => {
              if (!disabled) {
                valuesBeforeSlideStartRef.current = values;
                isKeyboardInteractionRef.current = false;
              }
            }),
            min,
            max,
            inverted,
            onSlideStart: disabled ? void 0 : handleSlideStart,
            onSlideMove: disabled ? void 0 : handleSlideMove,
            onSlideEnd: disabled ? void 0 : handleSlideEnd,
            onHomeKeyDown: () => {
              if (!disabled) {
                isKeyboardInteractionRef.current = true;
                updateValues(min, 0, { commit: true });
              }
            },
            onEndKeyDown: () => {
              if (!disabled) {
                isKeyboardInteractionRef.current = true;
                updateValues(max, values.length - 1, { commit: true });
              }
            },
            onStepKeyDown: ({ event, direction: stepDirection }) => {
              if (!disabled) {
                isKeyboardInteractionRef.current = true;
                const isPageKey = PAGE_KEYS.includes(event.key);
                const isSkipKey = isPageKey || event.shiftKey && ARROW_KEYS.includes(event.key);
                const multiplier = isSkipKey ? 10 : 1;
                const atIndex = valueIndexToChangeRef.current;
                const value2 = values[atIndex];
                const nextValue = getNextStepValue(value2, {
                  min,
                  step,
                  direction: stepDirection,
                  multiplier
                });
                updateValues(nextValue, atIndex, { commit: true });
              }
            }
          }
        ) }) })
      }
    );
  }, "Slider")
);
var [SliderOrientationProvider, useSliderOrientationContext] = createSliderContext(SLIDER_NAME, {
  startEdge: "left",
  endEdge: "right",
  size: "width",
  direction: 1
});
var SliderHorizontal = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function SliderHorizontal2(props, forwardedRef) {
    const {
      min,
      max,
      dir,
      inverted,
      onSlideStart,
      onSlideMove,
      onSlideEnd,
      onStepKeyDown,
      ...sliderProps
    } = props;
    const [slider, setSlider] = React.useState(null);
    const composedRefs = useComposedRefs(forwardedRef, setSlider);
    const rectRef = React.useRef(void 0);
    const direction = useDirection(dir);
    const isDirectionLTR = direction === "ltr";
    const isSlidingFromLeft = isDirectionLTR && !inverted || !isDirectionLTR && inverted;
    function getValueFromPointer(pointerPosition) {
      const rect = rectRef.current || slider.getBoundingClientRect();
      const input = [0, rect.width];
      const output = isSlidingFromLeft ? [min, max] : [max, min];
      const value = linearScale(input, output);
      rectRef.current = rect;
      return value(pointerPosition - rect.left);
    }
    __name(getValueFromPointer, "getValueFromPointer");
    return /* @__PURE__ */ jsx(
      SliderOrientationProvider,
      {
        scope: props.__scopeSlider,
        startEdge: isSlidingFromLeft ? "left" : "right",
        endEdge: isSlidingFromLeft ? "right" : "left",
        direction: isSlidingFromLeft ? 1 : -1,
        size: "width",
        children: /* @__PURE__ */ jsx(
          SliderImpl,
          {
            dir: direction,
            "data-orientation": "horizontal",
            ...sliderProps,
            ref: composedRefs,
            style: {
              ...sliderProps.style,
              "--radix-slider-thumb-transform": "translateX(-50%)"
            },
            onSlideStart: (event) => {
              const value = getValueFromPointer(event.clientX);
              onSlideStart?.(value);
            },
            onSlideMove: (event) => {
              const value = getValueFromPointer(event.clientX);
              onSlideMove?.(value);
            },
            onSlideEnd: () => {
              rectRef.current = void 0;
              onSlideEnd?.();
            },
            onStepKeyDown: (event) => {
              const slideDirection = isSlidingFromLeft ? "from-left" : "from-right";
              const isBackKey = BACK_KEYS[slideDirection].includes(event.key);
              onStepKeyDown?.({ event, direction: isBackKey ? -1 : 1 });
            }
          }
        )
      }
    );
  }, "SliderHorizontal")
);
var SliderVertical = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function SliderVertical2(props, forwardedRef) {
    const {
      min,
      max,
      inverted,
      onSlideStart,
      onSlideMove,
      onSlideEnd,
      onStepKeyDown,
      ...sliderProps
    } = props;
    const sliderRef = React.useRef(null);
    const ref = useComposedRefs(forwardedRef, sliderRef);
    const rectRef = React.useRef(void 0);
    const isSlidingFromBottom = !inverted;
    function getValueFromPointer(pointerPosition) {
      const rect = rectRef.current || sliderRef.current.getBoundingClientRect();
      const input = [0, rect.height];
      const output = isSlidingFromBottom ? [max, min] : [min, max];
      const value = linearScale(input, output);
      rectRef.current = rect;
      return value(pointerPosition - rect.top);
    }
    __name(getValueFromPointer, "getValueFromPointer");
    return /* @__PURE__ */ jsx(
      SliderOrientationProvider,
      {
        scope: props.__scopeSlider,
        startEdge: isSlidingFromBottom ? "bottom" : "top",
        endEdge: isSlidingFromBottom ? "top" : "bottom",
        size: "height",
        direction: isSlidingFromBottom ? 1 : -1,
        children: /* @__PURE__ */ jsx(
          SliderImpl,
          {
            "data-orientation": "vertical",
            ...sliderProps,
            ref,
            style: {
              ...sliderProps.style,
              "--radix-slider-thumb-transform": "translateY(50%)"
            },
            onSlideStart: (event) => {
              const value = getValueFromPointer(event.clientY);
              onSlideStart?.(value);
            },
            onSlideMove: (event) => {
              const value = getValueFromPointer(event.clientY);
              onSlideMove?.(value);
            },
            onSlideEnd: () => {
              rectRef.current = void 0;
              onSlideEnd?.();
            },
            onStepKeyDown: (event) => {
              const slideDirection = isSlidingFromBottom ? "from-bottom" : "from-top";
              const isBackKey = BACK_KEYS[slideDirection].includes(event.key);
              onStepKeyDown?.({ event, direction: isBackKey ? -1 : 1 });
            }
          }
        )
      }
    );
  }, "SliderVertical")
);
var SliderImpl = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function SliderImpl2(props, forwardedRef) {
    const {
      __scopeSlider,
      onSlideStart,
      onSlideMove,
      onSlideEnd,
      onHomeKeyDown,
      onEndKeyDown,
      onStepKeyDown,
      ...sliderProps
    } = props;
    const context = useSliderContext(SLIDER_NAME, __scopeSlider);
    return /* @__PURE__ */ jsx(
      Primitive.span,
      {
        ...sliderProps,
        ref: forwardedRef,
        onKeyDown: composeEventHandlers(props.onKeyDown, (event) => {
          if (event.key === "Home") {
            onHomeKeyDown(event);
            event.preventDefault();
          } else if (event.key === "End") {
            onEndKeyDown(event);
            event.preventDefault();
          } else if (PAGE_KEYS.concat(ARROW_KEYS).includes(event.key)) {
            onStepKeyDown(event);
            event.preventDefault();
          }
        }),
        onPointerDown: composeEventHandlers(props.onPointerDown, (event) => {
          const target = event.target;
          target.setPointerCapture(event.pointerId);
          event.preventDefault();
          if (context.thumbs.has(target)) {
            target.focus({ preventScroll: true, focusVisible: false });
          } else {
            onSlideStart(event);
          }
        }),
        onPointerMove: composeEventHandlers(props.onPointerMove, (event) => {
          const target = event.target;
          if (target.hasPointerCapture(event.pointerId)) onSlideMove(event);
        }),
        onPointerUp: composeEventHandlers(props.onPointerUp, (event) => {
          const target = event.target;
          if (target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
            onSlideEnd(event);
          }
        })
      }
    );
  }, "SliderImpl")
);
var TRACK_NAME = "SliderTrack";
var SliderTrack = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function SliderTrack2(props, forwardedRef) {
    const { __scopeSlider, ...trackProps } = props;
    const context = useSliderContext(TRACK_NAME, __scopeSlider);
    return /* @__PURE__ */ jsx(
      Primitive.span,
      {
        "data-disabled": context.disabled ? "" : void 0,
        "data-orientation": context.orientation,
        ...trackProps,
        ref: forwardedRef
      }
    );
  }, "SliderTrack")
);
var RANGE_NAME = "SliderRange";
var SliderRange = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function SliderRange2(props, forwardedRef) {
    const { __scopeSlider, ...rangeProps } = props;
    const context = useSliderContext(RANGE_NAME, __scopeSlider);
    const orientation = useSliderOrientationContext(RANGE_NAME, __scopeSlider);
    const ref = React.useRef(null);
    const composedRefs = useComposedRefs(forwardedRef, ref);
    const valuesCount = context.values.length;
    const percentages = context.values.map(
      (value) => convertValueToPercentage(value, context.min, context.max)
    );
    const offsetStart = valuesCount > 1 ? Math.min(...percentages) : 0;
    const offsetEnd = 100 - Math.max(...percentages);
    return /* @__PURE__ */ jsx(
      Primitive.span,
      {
        "data-orientation": context.orientation,
        "data-disabled": context.disabled ? "" : void 0,
        ...rangeProps,
        ref: composedRefs,
        style: {
          ...props.style,
          [orientation.startEdge]: offsetStart + "%",
          [orientation.endEdge]: offsetEnd + "%"
        }
      }
    );
  }, "SliderRange")
);
var THUMB_NAME = "SliderThumb";
var [SliderThumbContextProvider, useSliderThumbContext] = createSliderContext(THUMB_NAME);
var THUMB_PROVIDER_NAME = "SliderThumbProvider";
function SliderThumbProvider(props) {
  const {
    __scopeSlider,
    name,
    children,
    // @ts-expect-error internal render prop
    internal_do_not_use_render
  } = props;
  const context = useSliderContext(THUMB_PROVIDER_NAME, __scopeSlider);
  const getItems = useCollection(__scopeSlider);
  const [thumb, setThumb] = React.useState(null);
  const index = React.useMemo(
    () => thumb ? getItems().findIndex((item) => item.ref.current === thumb) : -1,
    [getItems, thumb]
  );
  const size = useSize(thumb);
  const isFormControl = thumb ? !!context.form || !!thumb.closest("form") : true;
  const value = context.values[index];
  const resolvedName = name ?? (context.name ? context.name + (context.values.length > 1 ? "[]" : "") : void 0);
  const percent = value === void 0 ? 0 : convertValueToPercentage(value, context.min, context.max);
  React.useEffect(() => {
    if (thumb) {
      context.thumbs.add(thumb);
      return () => {
        context.thumbs.delete(thumb);
      };
    }
  }, [thumb, context.thumbs]);
  const thumbContext = {
    value,
    name: resolvedName,
    form: context.form,
    isFormControl,
    index,
    thumb,
    onThumbChange: setThumb,
    percent,
    size
  };
  return /* @__PURE__ */ jsx(SliderThumbContextProvider, { scope: __scopeSlider, ...thumbContext, children: isFunction(internal_do_not_use_render) ? internal_do_not_use_render(thumbContext) : children });
}
__name(SliderThumbProvider, "SliderThumbProvider");
var THUMB_TRIGGER_NAME = "SliderThumbTrigger";
var SliderThumbTrigger = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function SliderThumbTrigger2(props, forwardedRef) {
    const { __scopeSlider, ...thumbProps } = props;
    const context = useSliderContext(THUMB_TRIGGER_NAME, __scopeSlider);
    const orientation = useSliderOrientationContext(THUMB_TRIGGER_NAME, __scopeSlider);
    const { index, value, percent, size, onThumbChange } = useSliderThumbContext(
      THUMB_TRIGGER_NAME,
      __scopeSlider
    );
    const composedRefs = useComposedRefs(forwardedRef, onThumbChange);
    const label = getLabel(index, context.values.length);
    const orientationSize = size?.[orientation.size];
    const thumbInBoundsOffset = orientationSize ? getThumbInBoundsOffset(orientationSize, percent, orientation.direction) : 0;
    return /* @__PURE__ */ jsx(
      "span",
      {
        style: {
          transform: "var(--radix-slider-thumb-transform)",
          position: "absolute",
          [orientation.startEdge]: `calc(${percent}% + ${thumbInBoundsOffset}px)`
        },
        children: /* @__PURE__ */ jsx(Collection.ItemSlot, { scope: __scopeSlider, children: /* @__PURE__ */ jsx(
          Primitive.span,
          {
            role: "slider",
            "aria-label": props["aria-label"] || label,
            "aria-valuemin": context.min,
            "aria-valuenow": value,
            "aria-valuemax": context.max,
            "aria-orientation": context.orientation,
            "data-orientation": context.orientation,
            "data-disabled": context.disabled ? "" : void 0,
            tabIndex: context.disabled ? void 0 : 0,
            ...thumbProps,
            ref: composedRefs,
            style: value === void 0 ? { display: "none" } : props.style,
            onFocus: composeEventHandlers(props.onFocus, () => {
              context.valueIndexToChangeRef.current = index;
            })
          }
        ) })
      }
    );
  }, "SliderThumbTrigger")
);
var SliderThumb = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function SliderThumb2(props, forwardedRef) {
    const { __scopeSlider, name, ...thumbProps } = props;
    return /* @__PURE__ */ jsx(
      SliderThumbProvider,
      {
        __scopeSlider,
        name,
        internal_do_not_use_render: ({ index, isFormControl }) => /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(
            SliderThumbTrigger,
            {
              ...thumbProps,
              ref: forwardedRef,
              __scopeSlider
            }
          ),
          isFormControl ? /* @__PURE__ */ jsx(
            SliderBubbleInput,
            {
              __scopeSlider
            },
            index
          ) : null
        ] })
      }
    );
  }, "SliderThumb")
);
var BUBBLE_INPUT_NAME = "SliderBubbleInput";
var SliderBubbleInput = /* @__PURE__ */ React.forwardRef(
  // blank line to reduce diff noise
  /* @__PURE__ */ __name(function SliderBubbleInput2({ __scopeSlider, ...props }, forwardedRef) {
    const { value, name, form } = useSliderThumbContext(BUBBLE_INPUT_NAME, __scopeSlider);
    const ref = React.useRef(null);
    const composedRefs = useComposedRefs(ref, forwardedRef);
    const prevValue = usePrevious(value);
    React.useEffect(() => {
      const input = ref.current;
      if (!input) return;
      const inputProto = window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(inputProto, "value");
      const setValue = descriptor.set;
      if (prevValue !== value && setValue) {
        const event = new Event("input", { bubbles: true });
        setValue.call(input, value);
        input.dispatchEvent(event);
      }
    }, [prevValue, value]);
    return /* @__PURE__ */ jsx(
      Primitive.input,
      {
        style: { display: "none" },
        name,
        form,
        ...props,
        ref: composedRefs,
        defaultValue: value
      }
    );
  }, "SliderBubbleInput")
);
function getNextSortedValues(prevValues = [], nextValue, atIndex) {
  const nextValues = [...prevValues];
  nextValues[atIndex] = nextValue;
  return nextValues.sort((a, b) => a - b);
}
__name(getNextSortedValues, "getNextSortedValues");
function convertValueToPercentage(value, min, max) {
  const maxSteps = max - min;
  const percentPerStep = 100 / maxSteps;
  const percentage = percentPerStep * (value - min);
  return clamp(percentage, [0, 100]);
}
__name(convertValueToPercentage, "convertValueToPercentage");
function getLabel(index, totalValues) {
  if (totalValues > 2) {
    return `Value ${index + 1} of ${totalValues}`;
  } else if (totalValues === 2) {
    return ["Minimum", "Maximum"][index];
  } else {
    return void 0;
  }
}
__name(getLabel, "getLabel");
function getClosestValueIndex(values, nextValue) {
  if (values.length === 1) return 0;
  const distances = values.map((value) => Math.abs(value - nextValue));
  const closestDistance = Math.min(...distances);
  return distances.indexOf(closestDistance);
}
__name(getClosestValueIndex, "getClosestValueIndex");
function getThumbInBoundsOffset(width, left, direction) {
  const halfWidth = width / 2;
  const halfPercent = 50;
  const offset = linearScale([0, halfPercent], [0, halfWidth]);
  return (halfWidth - offset(left) * direction) * direction;
}
__name(getThumbInBoundsOffset, "getThumbInBoundsOffset");
function getStepsBetweenValues(values) {
  return values.slice(0, -1).map((value, index) => values[index + 1] - value);
}
__name(getStepsBetweenValues, "getStepsBetweenValues");
function hasMinStepsBetweenValues(values, minStepsBetweenValues) {
  if (minStepsBetweenValues > 0) {
    const stepsBetweenValues = getStepsBetweenValues(values);
    const actualMinStepsBetweenValues = Math.min(...stepsBetweenValues);
    return actualMinStepsBetweenValues >= minStepsBetweenValues;
  }
  return true;
}
__name(hasMinStepsBetweenValues, "hasMinStepsBetweenValues");
function linearScale(input, output) {
  return (value) => {
    if (input[0] === input[1] || output[0] === output[1]) return output[0];
    const ratio = (output[1] - output[0]) / (input[1] - input[0]);
    return output[0] + ratio * (value - input[0]);
  };
}
__name(linearScale, "linearScale");
function getDecimalCount(value) {
  if (!Number.isFinite(value)) return 0;
  const str = value.toString();
  if (str.includes("e")) {
    const [coefficient, exponent] = str.split("e");
    const decimalPart2 = coefficient.split(".")[1] || "";
    const exponentNum = Number(exponent);
    return Math.max(0, decimalPart2.length - exponentNum);
  }
  const decimalPart = str.split(".")[1];
  return decimalPart ? decimalPart.length : 0;
}
__name(getDecimalCount, "getDecimalCount");
function roundValue(value, decimalCount) {
  const rounder = Math.pow(10, decimalCount);
  return Math.round(value * rounder) / rounder;
}
__name(roundValue, "roundValue");
function getNextStepValue(value, {
  min,
  step,
  direction,
  multiplier
}) {
  const decimalCount = getDecimalCount(step);
  const stepsFromMin = (value - min) / step;
  const nearestSteps = Math.round(stepsFromMin);
  const isAligned = roundValue(nearestSteps * step + min, decimalCount) === roundValue(value, decimalCount);
  let nextSteps;
  if (isAligned) {
    nextSteps = nearestSteps + multiplier * direction;
  } else if (direction > 0) {
    nextSteps = Math.ceil(stepsFromMin);
  } else {
    nextSteps = Math.floor(stepsFromMin);
  }
  return roundValue(nextSteps * step + min, decimalCount);
}
__name(getNextStepValue, "getNextStepValue");
function isFunction(value) {
  return typeof value === "function";
}
__name(isFunction, "isFunction");
export {
  SliderRange as Range,
  Slider as Root,
  Slider,
  SliderRange,
  SliderThumb,
  SliderTrack,
  SliderThumb as Thumb,
  SliderTrack as Track,
  createSliderScope,
  SliderBubbleInput as unstable_BubbleInput,
  SliderBubbleInput as unstable_SliderBubbleInput,
  SliderThumbProvider as unstable_SliderThumbProvider,
  SliderThumbTrigger as unstable_SliderThumbTrigger,
  SliderThumbProvider as unstable_ThumbProvider,
  SliderThumbTrigger as unstable_ThumbTrigger
};
//# sourceMappingURL=index.mjs.map
