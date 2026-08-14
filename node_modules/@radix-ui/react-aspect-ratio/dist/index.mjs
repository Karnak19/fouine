var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/aspect-ratio.tsx
import * as React from "react";
import { Primitive } from "@radix-ui/react-primitive";
import { jsx } from "react/jsx-runtime";
var AspectRatio = /* @__PURE__ */ React.forwardRef(
  /* @__PURE__ */ __name(function AspectRatio2(props, forwardedRef) {
    const { ratio = 1 / 1, style, ...aspectRatioProps } = props;
    return /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          // ensures inner element is contained
          position: "relative",
          // ensures padding bottom trick maths works
          width: "100%",
          paddingBottom: `${100 / ratio}%`
        },
        "data-radix-aspect-ratio-wrapper": "",
        children: /* @__PURE__ */ jsx(
          Primitive.div,
          {
            ...aspectRatioProps,
            ref: forwardedRef,
            style: {
              ...style,
              // ensures children expand in ratio
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0
            }
          }
        )
      }
    );
  }, "AspectRatio")
);
var Root = AspectRatio;
export {
  AspectRatio,
  Root
};
//# sourceMappingURL=index.mjs.map
