"use client";

import { File } from "@/components/assistant-ui/file";
import { ThreadFollowupSuggestions } from "@/components/assistant-ui/follow-up-suggestions";
import { Image } from "@/components/assistant-ui/image";
import { StreamdownText } from "@/components/assistant-ui/streamdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger
} from "@/components/assistant-ui/tool-group";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import {
  color,
  font,
  leading,
  radius,
  shadow,
  space,
  text
} from "@/tokens.stylex";
import { shared } from "@/styles";
import { attrStyle } from "@/lib/sx";
import * as stylex from "@stylexjs/stylex";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type ToolCallMessagePartComponent,
  useAuiState
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon
} from "lucide-react";
import {
  createContext,
  useContext,
  type ComponentType,
  type FC,
  type PropsWithChildren
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

// Tailwind's `animate-pulse`, which is gone with the utility classes. Same
// timing so the working indicator and the dictation square breathe as before.
const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });

// The composer's shell is drawn twice (new message, and editing an existing
// one) off the same four custom properties, which stay CSS vars so the two
// copies cannot drift.
const COMPOSER_SHADOW =
  "0 4px 16px -8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)";
const COMPOSER_SHADOW_FOCUS =
  "0 6px 24px -8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.05)";
const DARK = "@media (prefers-color-scheme: dark)";

const s = stylex.create({
  root: {
    backgroundColor: color.background,
    containerType: "inline-size",
    display: "flex",
    height: "100%",
    flexDirection: "column"
  },
  viewport: {
    position: "relative",
    display: "flex",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: "column",
    overflowX: "auto",
    overflowY: "scroll",
    scrollBehavior: "smooth"
  },
  column: {
    marginInline: "auto",
    display: "flex",
    width: "100%",
    maxWidth: "var(--thread-max-width)",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: "column",
    paddingInline: space.x16,
    paddingTop: space.x16
  },
  columnCentered: { justifyContent: "center" },
  messageGroup: {
    marginBottom: space.x56,
    display: { default: "flex", ":empty": "none" },
    flexDirection: "column",
    rowGap: space.x24
  },
  footer: {
    backgroundColor: color.background,
    display: "flex",
    flexDirection: "column",
    gap: space.x16,
    overflow: "visible",
    paddingBottom: { default: space.x16, "@media (min-width: 768px)": space.x24 }
  },
  footerDocked: {
    position: "sticky",
    bottom: 0,
    marginTop: "auto",
    borderTopLeftRadius: "var(--composer-radius)",
    borderTopRightRadius: "var(--composer-radius)"
  },
  scrollToBottom: {
    position: "absolute",
    top: `calc(-1 * ${space.x48})`,
    zIndex: 10,
    alignSelf: "center",
    borderRadius: radius.full,
    padding: space.x16,
    visibility: { default: null, ":disabled": "hidden" },
    borderColor: { default: null, [DARK]: color.border },
    backgroundColor: {
      default: null,
      [DARK]: { default: color.background, ":hover": color.accent }
    }
  },
  welcome: {
    marginBottom: space.x24,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingInline: space.x16,
    textAlign: "center"
  },
  welcomeHeading: {
    fontSize: text.xl2,
    lineHeight: leading.xl2,
    fontWeight: 600,
    transitionDuration: "200ms"
  },
  suggestions: {
    display: "flex",
    width: "100%",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x8,
    paddingInline: space.x16
  },
  suggestionDisplay: { transitionDuration: "200ms" },
  suggestion: {
    color: color.foreground,
    backgroundColor: { default: null, ":hover": color.muted },
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: `color-mix(in oklab, ${color.border} 60%, transparent)`,
    height: "auto",
    gap: space.x6,
    borderRadius: radius.full,
    paddingInline: space.x14,
    paddingBlock: space.x6,
    fontSize: text.sm,
    lineHeight: leading.sm,
    fontWeight: 400,
    whiteSpace: "nowrap",
    transitionProperty: "color, background-color, border-color",
    transitionDuration: "150ms"
  },
  hideWhenEmpty: { display: { default: null, ":empty": "none" } },
  composerRoot: {
    position: "relative",
    display: "flex",
    width: "100%",
    flexDirection: "column"
  },
  composerShell: {
    display: "flex",
    width: "100%",
    flexDirection: "column",
    gap: space.x8,
    borderRadius: "var(--composer-radius)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: `color-mix(in oklab, ${color.border} 60%, transparent)`,
      ":focus-within": color.border,
      [DARK]: {
        default: `color-mix(in oklab, ${color.mutedForeground} 15%, transparent)`,
        ":focus-within": `color-mix(in oklab, ${color.mutedForeground} 30%, transparent)`
      }
    },
    backgroundColor: "var(--composer-bg)",
    padding: "var(--composer-padding)",
    transitionProperty: "border-color, box-shadow",
    boxShadow: {
      default: COMPOSER_SHADOW,
      ":focus-within": COMPOSER_SHADOW_FOCUS,
      [DARK]: { default: "none", ":focus-within": "none" }
    }
  },
  composerInput: {
    caretColor: color.primary,
    "::placeholder": {
      color: `color-mix(in oklab, ${color.mutedForeground} 80%, transparent)`
    },
    maxHeight: space.x128,
    minHeight: space.x40,
    width: "100%",
    resize: "none",
    backgroundColor: "transparent",
    paddingInline: space.x10,
    paddingBlock: space.x4,
    fontSize: text.base,
    lineHeight: leading.base,
    outlineStyle: "none"
  },
  composerActionWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end"
  },
  composerButton: {
    height: space.x28,
    width: space.x28,
    borderRadius: radius.full
  },
  destructive: { color: color.destructive },
  // TOKEN MISSING: 1.125rem (size-4.5)
  icon45: { height: "1.125rem", width: "1.125rem" },
  icon35: { height: space.x14, width: space.x14 },
  fillCurrent: { fill: "currentColor" },
  pulse: {
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  errorRoot: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.destructive,
    backgroundColor: {
      default: `color-mix(in oklab, ${color.destructive} 10%, transparent)`,
      [DARK]: `color-mix(in oklab, ${color.destructive} 5%, transparent)`
    },
    color: { default: color.destructive, [DARK]: color.dangerTextSoft },
    marginTop: space.x8,
    borderRadius: radius.md,
    padding: space.x12,
    fontSize: text.sm,
    lineHeight: leading.sm
  },
  errorMessage: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden"
  },
  assistantMessage: {
    position: "relative",
    marginBottom: `calc(-1 * ${space.x30})`,
    paddingBottom: space.x30,
    transitionDuration: "150ms",
    containIntrinsicSize: "auto 200px",
    contentVisibility: "auto"
  },
  assistantContent: {
    color: color.foreground,
    paddingInline: space.x8,
    lineHeight: leading.relaxed,
    overflowWrap: "break-word"
  },
  partPadding: { paddingBlock: space.x4 },
  indicator: { fontFamily: font.sans },
  // Keep the action bar inside the contained root's paint box, then cancel its
  // reserved space in flow.
  assistantFooter: {
    marginInlineStart: space.x8,
    display: "flex",
    alignItems: "center",
    minHeight: space.x30,
    paddingTop: space.x6
  },
  actionBar: {
    color: color.mutedForeground,
    gridColumnStart: "3",
    gridRowStart: "2",
    marginInlineStart: `calc(-1 * ${space.x4})`,
    display: "flex",
    gap: space.x4,
    transitionDuration: "200ms"
  },
  copiedIcon: {
    transitionDuration: "200ms",
    transitionTimingFunction: "cubic-bezier(0, 0, 0.2, 1)"
  },
  copyIcon: { transitionDuration: "150ms" },
  // A data-attribute condition types its value as `unknown` — crosses the prop
  // boundary through `attrStyle()`. See lib/sx.ts.
  moreOpen: { backgroundColor: { default: null, '[data-state="open"]': color.accent } },
  moreContent: {
    backgroundColor: `color-mix(in oklab, ${color.popover} 95%, transparent)`,
    color: color.popoverForeground,
    zIndex: 50,
    minWidth: space.x128,
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "currentColor",
    padding: space.x6,
    boxShadow: shadow.lg,
    backdropFilter: "blur(8px)"
  },
  moreItem: {
    backgroundColor: {
      default: null,
      ":hover": color.accent,
      ":focus": color.accent
    },
    color: {
      default: null,
      ":hover": color.accentForeground,
      ":focus": color.accentForeground
    },
    display: "flex",
    cursor: "pointer",
    alignItems: "center",
    gap: space.x8,
    borderRadius: radius.lg,
    paddingInline: space.x10,
    paddingBlock: space.x6,
    fontSize: text.sm,
    lineHeight: leading.sm,
    outlineStyle: "none",
    userSelect: "none"
  },
  userMessage: {
    display: "grid",
    gridAutoRows: "auto",
    gridTemplateColumns: "minmax(72px, 1fr) auto",
    alignContent: "flex-start",
    rowGap: space.x8,
    paddingInline: space.x8,
    transitionDuration: "150ms",
    containIntrinsicSize: "auto 200px",
    contentVisibility: "auto"
  },
  userContentWrapper: { position: "relative", gridColumnStart: "2", minWidth: 0 },
  userContent: {
    backgroundColor: color.muted,
    color: color.foreground,
    borderRadius: radius.xl,
    paddingInline: space.x16,
    paddingBlock: space.x8,
    overflowWrap: "break-word",
    display: { default: null, ":empty": "none" }
  },
  // Was `start-0 -translate-x-full` plus an `rtl:translate-x-full` flip. A
  // transform flip needs an ancestor's direction, which StyleX cannot select
  // on (and lightningcss downlevels `:dir(rtl)` to a `:lang()` list that
  // misses `[dir="rtl"]` entirely). `inset-inline-end: 100%` parks the box
  // just outside the bubble's inline-start edge and is direction-aware on its
  // own — same position, no flip needed.
  userActionBarWrapper: {
    position: "absolute",
    insetInlineEnd: "100%",
    top: "50%",
    transform: "translateY(-50%)",
    paddingInlineEnd: space.x8
  },
  userActionBar: { display: "flex", flexDirection: "column", alignItems: "flex-end" },
  userBranchPicker: {
    gridColumnStart: "1",
    gridColumnEnd: "-1",
    gridRowStart: "3",
    marginInlineEnd: `calc(-1 * ${space.x4})`,
    justifyContent: "flex-end"
  },
  editComposerWrapper: {
    display: "flex",
    flexDirection: "column",
    paddingInline: space.x8,
    containIntrinsicSize: "auto 200px",
    contentVisibility: "auto"
  },
  editComposerRoot: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: `color-mix(in oklab, ${color.border} 60%, transparent)`,
      [DARK]: `color-mix(in oklab, ${color.mutedForeground} 15%, transparent)`
    },
    marginInlineStart: "auto",
    display: "flex",
    width: "100%",
    maxWidth: "85%",
    flexDirection: "column",
    borderRadius: "var(--composer-radius)",
    backgroundColor: "var(--composer-bg)",
    boxShadow: { default: COMPOSER_SHADOW, [DARK]: "none" }
  },
  editComposerInput: {
    color: color.foreground,
    minHeight: space.x56,
    width: "100%",
    resize: "none",
    backgroundColor: "transparent",
    paddingInline: space.x16,
    paddingTop: space.x12,
    paddingBottom: space.x4,
    fontSize: text.base,
    lineHeight: leading.base,
    outlineStyle: "none"
  },
  editComposerFooter: {
    marginInline: space.x10,
    marginBottom: space.x10,
    display: "flex",
    alignItems: "center",
    gap: space.x6,
    alignSelf: "flex-end"
  },
  editComposerButton: {
    height: space.x32,
    borderRadius: radius.full,
    paddingInline: space.x14
  },
  branchPicker: {
    color: color.mutedForeground,
    marginInlineStart: `calc(-1 * ${space.x8})`,
    marginInlineEnd: space.x8,
    display: "inline-flex",
    alignItems: "center",
    fontSize: text.xs,
    lineHeight: leading.xs
  },
  branchPickerState: { fontWeight: 500 }
});

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);
  const root = stylex.props(s.root);
  const footer = stylex.props(s.footer, !isEmpty && s.footerDocked);

  return (
    <ThreadPrimitive.Root
      {...root}
      className={`aui-root aui-thread-root ${root.className ?? ""}`}
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px"
      }}
    >
      <ThreadPrimitive.Viewport
        // "top" (the registry default) pins your question to the top and lets
        // the answer grow past the fold, so a long answer reads as if nothing
        // scrolled. "bottom" follows the stream instead.
        turnAnchor="bottom"
        data-slot="aui_thread-viewport"
        {...stylex.props(s.viewport)}
      >
        <div {...stylex.props(s.column, isEmpty && s.columnCentered)}>
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            {...stylex.props(s.messageGroup)}
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            {...footer}
            className={`aui-thread-viewport-footer ${footer.className ?? ""}`}
          >
            <ThreadScrollToBottom />
            <ThreadFollowupSuggestions />
            <Composer />
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              <ThreadSuggestions />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom"
        sx={s.scrollToBottom}
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  const root = stylex.props(s.welcome);
  const heading = stylex.props(s.welcomeHeading);

  return (
    <div
      {...root}
      className={`aui-thread-welcome-root ${root.className ?? ""}`}
    >
      <h1
        {...heading}
        className={`aui-thread-welcome-message-inner ${heading.className ?? ""}`}
      >
        How can I help you today?
      </h1>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  const root = stylex.props(s.suggestions);

  return (
    <div
      {...root}
      className={`aui-thread-welcome-suggestions ${root.className ?? ""}`}
    >
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  const display = stylex.props(s.suggestionDisplay);
  const description = stylex.props(s.hideWhenEmpty);

  return (
    <div
      {...display}
      className={`aui-thread-welcome-suggestion-display ${display.className ?? ""}`}
    >
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion"
          sx={s.suggestion}
        >
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
          <SuggestionPrimitive.Description
            {...description}
            className={`aui-thread-welcome-suggestion-text-2 ${description.className ?? ""}`}
          />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC = () => {
  const root = stylex.props(s.composerRoot);
  const input = stylex.props(s.composerInput);

  return (
    <ComposerPrimitive.Root
      {...root}
      className={`aui-composer-root ${root.className ?? ""}`}
    >
      {/* No attachment dropzone: POST /api/chat sends user text only, so a
          dropped file would be silently discarded. Don't re-add the dropzone
          or the add-attachment button from the upstream registry. */}
      <div data-slot="aui_composer-shell" {...stylex.props(s.composerShell)}>
        <ComposerPrimitive.Input
          placeholder="Send a message..."
          {...input}
          className={`aui-composer-input ${input.className ?? ""}`}
          rows={1}
          autoFocus
          enterKeyHint="send"
          aria-label="Message input"
        />
        <ComposerAction />
      </div>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const wrapper = stylex.props(s.composerActionWrapper);
  const dictateIcon = stylex.props(shared.icon);
  const stopDictationIcon = stylex.props(s.icon35, s.pulse, s.fillCurrent);
  const sendIcon = stylex.props(s.icon45);
  const cancelIcon = stylex.props(s.icon35, s.fillCurrent);

  return (
    <div
      {...wrapper}
      className={`aui-composer-action-wrapper ${wrapper.className ?? ""}`}
    >
      <div {...stylex.props(shared.rowTight)}>
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate"
                sx={s.composerButton}
                aria-label="Start voice input"
              >
                <MicIcon
                  {...dictateIcon}
                  className={`aui-composer-dictate-icon ${dictateIcon.className ?? ""}`}
                />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation"
                sx={[s.composerButton, s.destructive]}
                aria-label="Stop voice input"
              >
                <SquareIcon
                  {...stopDictationIcon}
                  className={`aui-composer-stop-dictation-icon ${stopDictationIcon.className ?? ""}`}
                />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send"
              sx={s.composerButton}
              aria-label="Send message"
            >
              <ArrowUpIcon
                {...sendIcon}
                className={`aui-composer-send-icon ${sendIcon.className ?? ""}`}
              />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel"
              sx={s.composerButton}
              aria-label="Stop generating"
            >
              <SquareIcon
                {...cancelIcon}
                className={`aui-composer-cancel-icon ${cancelIcon.className ?? ""}`}
              />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  const root = stylex.props(s.errorRoot);
  const message = stylex.props(s.errorMessage);

  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root
        {...root}
        className={`aui-message-error-root ${root.className ?? ""}`}
      >
        <ErrorPrimitive.Message
          {...message}
          className={`aui-message-error-message ${message.className ?? ""}`}
        />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup
  } = useContext(ThreadComponentsContext);

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      {...stylex.props(s.assistantMessage)}
    >
      <div
        data-slot="aui_assistant-message-content"
        {...stylex.props(s.assistantContent)}
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought", "group-tool"],
            "standalone-tool-call": []
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <ToolGroupRoot variant="ghost">
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                const running = part.status.type === "running";
                // ghost, like the tool group above it — the default outline
                // variant boxes every reasoning block in a border that shouts
                // louder than the answer it precedes.
                return (
                  <ReasoningRoot variant="ghost" streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <StreamdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "file":
                return (
                  <div
                    data-slot="aui_assistant-message-file"
                    {...stylex.props(s.partPadding)}
                  >
                    <File {...part} />
                  </div>
                );
              case "image":
                return (
                  <div
                    data-slot="aui_assistant-message-image"
                    {...stylex.props(s.partPadding)}
                  >
                    <Image {...part} />
                  </div>
                );
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    {...stylex.props(s.indicator, s.pulse)}
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        {...stylex.props(s.assistantFooter)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  const root = stylex.props(s.actionBar);
  const content = stylex.props(s.moreContent);
  const item = stylex.props(s.moreItem);

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      {...root}
      className={`aui-assistant-action-bar-root ${root.className ?? ""}`}
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon {...stylex.props(s.copiedIcon)} />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon {...stylex.props(s.copyIcon)} />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            sx={attrStyle(s.moreOpen)}
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          {...content}
          className={`aui-action-bar-more-content ${content.className ?? ""}`}
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item
              {...item}
              className={`aui-action-bar-more-item ${item.className ?? ""}`}
            >
              <DownloadIcon {...stylex.props(shared.icon)} />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" {...stylex.props(s.partPadding)}>
    <File {...part} />
  </div>
);

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" {...stylex.props(s.partPadding)}>
    <Image {...part} />
  </div>
);

const UserMessage: FC = () => {
  const wrapper = stylex.props(s.userContentWrapper);
  const content = stylex.props(s.userContent);
  const actionBarWrapper = stylex.props(s.userActionBarWrapper);

  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      {...stylex.props(s.userMessage)}
      data-role="user"
    >
      <div
        {...wrapper}
        className={`aui-user-message-content-wrapper ${wrapper.className ?? ""}`}
      >
        {/* `peer` / `peer-empty:hidden` stay Tailwind: StyleX has no sibling
            selector, and the action bar has to disappear when the bubble next
            to it renders empty. */}
        <div
          {...content}
          className={`aui-user-message-content peer ${content.className ?? ""}`}
        >
          <MessagePrimitive.Parts
            components={{ File: UserFilePart, Image: UserImagePart }}
          />
        </div>
        <div
          {...actionBarWrapper}
          className={`aui-user-action-bar-wrapper peer-empty:hidden ${actionBarWrapper.className ?? ""}`}
        >
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        style={s.userBranchPicker}
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  const root = stylex.props(s.userActionBar);

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      {...root}
      className={`aui-user-action-bar-root ${root.className ?? ""}`}
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  const root = stylex.props(s.editComposerRoot);
  const input = stylex.props(s.editComposerInput);
  const footer = stylex.props(s.editComposerFooter);

  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      {...stylex.props(s.editComposerWrapper)}
    >
      <ComposerPrimitive.Root
        {...root}
        className={`aui-edit-composer-root ${root.className ?? ""}`}
      >
        <ComposerPrimitive.Input
          {...input}
          className={`aui-edit-composer-input ${input.className ?? ""}`}
          autoFocus
        />
        <div
          {...footer}
          className={`aui-edit-composer-footer ${footer.className ?? ""}`}
        >
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" sx={s.editComposerButton}>
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" sx={s.editComposerButton}>
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

type BranchPickerProps = Omit<
  BranchPickerPrimitive.Root.Props,
  "className" | "style"
> & { style?: stylex.StyleXStyles };

const BranchPicker: FC<BranchPickerProps> = ({ style, ...rest }) => {
  const root = stylex.props(s.branchPicker, style);
  const state = stylex.props(s.branchPickerState);

  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      {...rest}
      {...root}
      className={`aui-branch-picker-root ${root.className ?? ""}`}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span
        {...state}
        className={`aui-branch-picker-state ${state.className ?? ""}`}
      >
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
