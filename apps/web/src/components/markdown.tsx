import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";

// Same Streamdown + shiki pair as the chat page (see
// assistant-ui/streamdown-text.tsx), but used directly since this content
// isn't part of an assistant-ui message stream. mode="static" skips the
// token-by-token reveal animation — review bodies arrive whole, not
// streamed.
//
// Sizing is done via arbitrary descendant selectors on Streamdown's own
// `data-streamdown` attributes rather than a `components` override: the
// default code component dispatches block vs. inline rendering off a
// `data-block` prop set by its `pre` wrapper, so replacing it would silently
// drop shiki highlighting for fenced code blocks.
export function Markdown({ children }: { children: string }) {
  return (
    <Streamdown
      mode="static"
      plugins={{ code }}
      shikiTheme={["one-light", "one-dark-pro"]}
      className="text-sm text-zinc-200
        [&_[data-streamdown=heading-1]]:mt-3 [&_[data-streamdown=heading-1]]:mb-1.5 [&_[data-streamdown=heading-1]]:text-base [&_[data-streamdown=heading-1]]:font-medium
        [&_[data-streamdown=heading-2]]:mt-3 [&_[data-streamdown=heading-2]]:mb-1.5 [&_[data-streamdown=heading-2]]:text-base [&_[data-streamdown=heading-2]]:font-medium
        [&_[data-streamdown=heading-3]]:mt-2 [&_[data-streamdown=heading-3]]:mb-1 [&_[data-streamdown=heading-3]]:text-sm [&_[data-streamdown=heading-3]]:font-medium
        [&_[data-streamdown=inline-code]]:bg-zinc-800/60 [&_[data-streamdown=inline-code]]:rounded [&_[data-streamdown=inline-code]]:px-1 [&_[data-streamdown=inline-code]]:py-0 [&_[data-streamdown=inline-code]]:font-mono [&_[data-streamdown=inline-code]]:text-[0.85em]"
    >
      {children}
    </Streamdown>
  );
}
