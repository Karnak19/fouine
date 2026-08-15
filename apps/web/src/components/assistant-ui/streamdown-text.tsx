"use client";

import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { code } from "@streamdown/code";
import { memo } from "react";

// Streamdown + shiki, the same pair the old ai-elements chat rendered with, so
// answers keep their tables and their highlighted SQL. Themes match what
// code-block.tsx used before: one-light / one-dark-pro.
const StreamdownTextImpl = () => (
  <StreamdownTextPrimitive
    plugins={{ code }}
    shikiTheme={["one-light", "one-dark-pro"]}
  />
);

export const StreamdownText = memo(StreamdownTextImpl);
