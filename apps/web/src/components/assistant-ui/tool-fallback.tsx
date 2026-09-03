"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useRef,
  useState
} from "react";
import * as stylex from "@stylexjs/stylex";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  LoaderIcon,
  XCircleIcon
} from "lucide-react";
import {
  useScrollLock,
  useToolCallElapsed,
  type ToolApprovalOption,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus,
  type ToolCallMessagePartComponent
} from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { color, radius, space, text } from "@/tokens.stylex";

const ANIMATION_DURATION = 200;

// The chevron used to rotate off `group-data-open/trigger:` — a parent-state
// selector StyleX cannot express. The Root already computes the open state, so
// it hands it down instead. Markup and data attributes are unchanged.
const ToolFallbackOpenContext = createContext(false);

const s = stylex.create({
  root: { width: "100%" },

  pressable: { transform: { default: null, ":active": "scale(0.98)" } },

  duration: {
    color: color.mutedForeground,
    fontSize: text.xs,
    lineHeight: 1.33333,
    fontVariantNumeric: "tabular-nums"
  },

  trigger: {
    display: "flex",
    width: "fit-content",
    transformOrigin: "0",
    alignItems: "center",
    gap: space.x8,
    paddingBlock: space.x6,
    fontSize: text.sm,
    lineHeight: 1.42857,
    color: { default: color.mutedForeground, ":hover": color.foreground },
    transitionProperty: "color, scale",
    transitionDuration: "150ms",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
    scale: { default: null, ":active": "0.98" }
  },

  icon: { width: space.x16, height: space.x16, flexShrink: 0 },
  iconCancelled: { color: color.mutedForeground },
  iconSpinning: {
    animationName: "spin",
    animationDuration: "0.6s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite"
  },

  label: {
    position: "relative",
    display: "inline-block",
    textAlign: "start",
    lineHeight: 1
  },
  labelCancelled: {
    color: color.mutedForeground,
    textDecorationLine: "line-through"
  },

  shimmer: {
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    animationName: {
      default: null,
      "@media (prefers-reduced-motion: reduce)": "none"
    }
  },

  chevron: {
    width: space.x16,
    height: space.x16,
    flexShrink: 0,
    transitionProperty: {
      default: "transform, translate, scale, rotate",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    transitionDuration: "var(--animation-duration)",
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)"
  },
  chevronClosed: { rotate: "-90deg" },
  chevronOpen: { rotate: "0deg" },

  content: {
    position: "relative",
    overflowX: "hidden",
    overflowY: "hidden",
    fontSize: text.sm,
    lineHeight: 1.42857,
    outlineStyle: "none",
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
    transitionDuration: "var(--animation-duration)",
    // `collapsible-down` / `collapsible-up` are declared in global.css.
    animationName: {
      default: null,
      '[data-state="open"]': {
        default: "collapsible-down",
        "@media (prefers-reduced-motion: reduce)": "none"
      },
      '[data-state="closed"]': {
        default: "collapsible-up",
        "@media (prefers-reduced-motion: reduce)": "none"
      }
    },
    animationDuration: "var(--animation-duration)",
    animationFillMode: { default: null, '[data-state="closed"]': "forwards" },
    pointerEvents: { default: null, '[data-state="closed"]': "none" }
  },
  contentInner: {
    display: "flex",
    flexDirection: "column",
    gap: space.x8,
    paddingInlineStart: space.x24,
    paddingTop: space.x4,
    paddingBottom: space.x8,
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
    transitionDuration: "var(--animation-duration)"
  },

  cancelled: { opacity: 0.6 },

  code: {
    backgroundColor: "color-mix(in oklab, var(--color-muted) 50%, transparent)",
    color: "color-mix(in oklab, var(--color-foreground) 90%, transparent)",
    borderRadius: radius.md,
    padding: space.x10,
    fontSize: text.xs,
    lineHeight: 1.33333,
    whiteSpace: "pre-wrap"
  },
  codeSpaced: { marginTop: space.x4 },

  resultHeader: {
    color: color.mutedForeground,
    fontSize: text.xs,
    lineHeight: 1.33333,
    fontWeight: 500
  },

  errorHeader: { color: color.mutedForeground, fontWeight: 600 },
  errorReason: { color: color.mutedForeground },

  approvalConfirm: {
    display: "flex",
    flexDirection: "column",
    gap: space.x8,
    paddingTop: space.x4
  },
  approvalConfirmTitle: { fontWeight: 600 },
  approvalConfirmDescription: { color: color.mutedForeground },
  grants: { display: "flex", flexDirection: "column", gap: space.x4 },
  grant: {
    backgroundColor: color.muted,
    borderRadius: radius.base,
    paddingInline: space.x6,
    paddingBlock: space.x2,
    fontSize: text.xs,
    lineHeight: 1.33333
  },
  buttonRow: { display: "flex", alignItems: "center", gap: space.x8 },
  approvalRow: {
    display: "flex",
    alignItems: "center",
    gap: space.x8,
    paddingTop: space.x4
  },
  approvalRowWrap: { flexWrap: "wrap" }
});

export type ToolFallbackRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange" | "className" | "style"
> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  style?: stylex.StyleXStyles;
};

function ToolFallbackRoot({
  style,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll();
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  const sx = stylex.props(s.root, style);

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      {...props}
      className={`aui-tool-fallback-root ${sx.className ?? ""}`}
      style={
        {
          ...sx.style,
          "--animation-duration": `${ANIMATION_DURATION}ms`
        } as React.CSSProperties
      }
    >
      <ToolFallbackOpenContext.Provider value={isOpen}>
        {children}
      </ToolFallbackOpenContext.Provider>
    </Collapsible>
  );
}

type ToolStatus = ToolCallMessagePartStatus["type"];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
  running: LoaderIcon,
  complete: CheckIcon,
  incomplete: XCircleIcon,
  "requires-action": AlertCircleIcon
};

const formatToolDuration = (ms: number) => {
  if (ms < 1000) return "<1s";
  const seconds = ms / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
};

function ToolFallbackDuration({
  style,
  ...props
}: Omit<React.ComponentProps<"span">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  const elapsedMs = useToolCallElapsed();
  if (elapsedMs === undefined) return null;

  const sx = stylex.props(s.duration, style);

  return (
    <span
      data-slot="tool-fallback-duration"
      {...props}
      className={`aui-tool-fallback-duration ${sx.className ?? ""}`}
      style={sx.style}
    >
      {formatToolDuration(elapsedMs)}
    </span>
  );
}

function ToolFallbackTrigger({
  toolName,
  status,
  style,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsibleTrigger>,
  "className" | "style"
> & {
  toolName: string;
  status?: ToolCallMessagePartStatus;
  style?: stylex.StyleXStyles;
}) {
  const isOpen = useContext(ToolFallbackOpenContext);
  const statusType = status?.type ?? "complete";
  const isRunning = statusType === "running";
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";

  const Icon = statusIconMap[statusType];
  const label = isCancelled ? "Cancelled tool" : "Used tool";

  const sx = stylex.props(s.trigger, style);
  const iconSx = stylex.props(
    s.icon,
    isCancelled && s.iconCancelled,
    isRunning && s.iconSpinning,
  );
  const labelSx = stylex.props(s.label, isCancelled && s.labelCancelled);
  const shimmerSx = stylex.props(s.shimmer);
  const chevronSx = stylex.props(
    s.chevron,
    isOpen ? s.chevronOpen : s.chevronClosed,
  );

  return (
    <CollapsibleTrigger
      data-slot="tool-fallback-trigger"
      {...props}
      className={`aui-tool-fallback-trigger ${sx.className ?? ""}`}
      style={sx.style}
    >
      <Icon
        data-slot="tool-fallback-trigger-icon"
        className={`aui-tool-fallback-trigger-icon ${iconSx.className ?? ""}`}
        style={iconSx.style}
      />
      <span
        data-slot="tool-fallback-trigger-label"
        className={`aui-tool-fallback-trigger-label-wrapper ${labelSx.className ?? ""}`}
        style={labelSx.style}
      >
        <span>
          {label}: <b>{toolName}</b>
        </span>
        {isRunning && (
          <span
            aria-hidden
            data-slot="tool-fallback-trigger-shimmer"
            // `shimmer` is vendored by tw-shimmer, not ours to migrate.
            className={`aui-tool-fallback-trigger-shimmer shimmer ${shimmerSx.className ?? ""}`}
            style={shimmerSx.style}
          >
            {label}: <b>{toolName}</b>
          </span>
        )}
      </span>
      <ToolFallbackDuration />
      <ChevronDownIcon
        data-slot="tool-fallback-trigger-chevron"
        className={`aui-tool-fallback-trigger-chevron ${chevronSx.className ?? ""}`}
        style={chevronSx.style}
      />
    </CollapsibleTrigger>
  );
}

function ToolFallbackContent({
  style,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof CollapsibleContent>,
  "className" | "style"
> & { style?: stylex.StyleXStyles }) {
  const sx = stylex.props(s.content, style);

  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      {...props}
      className={`aui-tool-fallback-content ${sx.className ?? ""}`}
      style={sx.style}
    >
      <div {...stylex.props(s.contentInner)}>{children}</div>
    </CollapsibleContent>
  );
}

function ToolFallbackArgs({
  argsText,
  style,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  argsText?: string;
  style?: stylex.StyleXStyles;
}) {
  if (!argsText) return null;

  const sx = stylex.props(style);
  const codeSx = stylex.props(s.code);

  return (
    <div
      data-slot="tool-fallback-args"
      {...props}
      className={`aui-tool-fallback-args ${sx.className ?? ""}`}
      style={sx.style}
    >
      <pre
        className={`aui-tool-fallback-args-value ${codeSx.className ?? ""}`}
        style={codeSx.style}
      >
        {argsText}
      </pre>
    </div>
  );
}

function ToolFallbackResult({
  result,
  style,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  result?: unknown;
  style?: stylex.StyleXStyles;
}) {
  if (result === undefined) return null;

  const sx = stylex.props(style);
  const headerSx = stylex.props(s.resultHeader);
  const codeSx = stylex.props(s.code, s.codeSpaced);

  return (
    <div
      data-slot="tool-fallback-result"
      {...props}
      className={`aui-tool-fallback-result ${sx.className ?? ""}`}
      style={sx.style}
    >
      <p
        className={`aui-tool-fallback-result-header ${headerSx.className ?? ""}`}
        style={headerSx.style}
      >
        Result:
      </p>
      <pre
        className={`aui-tool-fallback-result-content ${codeSx.className ?? ""}`}
        style={codeSx.style}
      >
        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

function ToolFallbackError({
  status,
  style,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> & {
  status?: ToolCallMessagePartStatus;
  style?: stylex.StyleXStyles;
}) {
  if (status?.type !== "incomplete") return null;

  const error = status.error;
  const errorText = error
    ? typeof error === "string"
      ? error
      : JSON.stringify(error)
    : null;

  if (!errorText) return null;

  const isCancelled = status.reason === "cancelled";
  const headerText = isCancelled ? "Cancelled reason:" : "Error:";

  const sx = stylex.props(style);
  const headerSx = stylex.props(s.errorHeader);
  const reasonSx = stylex.props(s.errorReason);

  return (
    <div
      data-slot="tool-fallback-error"
      {...props}
      className={`aui-tool-fallback-error ${sx.className ?? ""}`}
      style={sx.style}
    >
      <p
        className={`aui-tool-fallback-error-header ${headerSx.className ?? ""}`}
        style={headerSx.style}
      >
        {headerText}
      </p>
      <p
        className={`aui-tool-fallback-error-reason ${reasonSx.className ?? ""}`}
        style={reasonSx.style}
      >
        {errorText}
      </p>
    </div>
  );
}

const APPROVED_RESULT = "Approved by user";
const DENIED_RESULT = "User denied tool execution";

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
  "allow-once": "Allow",
  "allow-always": "Always allow",
  "reject-once": "Deny",
  "reject-always": "Always deny"
};

const isAllowKind = (kind: string) =>
  kind === "allow-once" || kind === "allow-always";

const approvalOptionLabel = (option: ToolApprovalOption) =>
  option.label ??
  (Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, option.kind)
    ? APPROVAL_OPTION_DEFAULT_LABELS[option.kind]
    : undefined) ??
  option.id;

function ToolFallbackApproval({
  style,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  ...props
}: Omit<React.ComponentProps<"div">, "className" | "style"> &
  Partial<
    Pick<ToolCallMessagePartProps, "addResult" | "resume" | "respondToApproval">
  > & {
    interrupt?: ToolCallMessagePart["interrupt"];
    approval?: ToolCallMessagePart["approval"];
    style?: stylex.StyleXStyles;
  }) {
  const [submitted, setSubmitted] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (
    approval != null &&
    (approval.approved !== undefined || approval.resolution !== undefined)
  )
    return null;

  // Custom (`_`-prefixed) kinds cannot be resolved to a boolean by the kit;
  // hosts using custom kinds render their own bar. A declared option list is
  // a host constraint: the kit never adds an approval path beyond it, but
  // always preserves a refusal path.
  const declaredOptions = respondToApproval ? approval?.options : undefined;
  const options = declaredOptions?.filter((o) =>
    Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, o.kind),
  );

  const respond = (approved: boolean) => {
    if (submitted) return;
    if (
      approval != null &&
      approval.approved === undefined &&
      respondToApproval
    ) {
      respondToApproval({ approved });
    } else if (interrupt) {
      resume?.({ approved });
    } else {
      addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT);
    }
    setSubmitted(true);
  };

  const respondWithOption = (option: ToolApprovalOption) => {
    if (submitted) return;
    respondToApproval?.({ optionId: option.id });
    setSubmitted(true);
    setConfirmingId(null);
  };

  const handleOption = (option: ToolApprovalOption) => {
    if (option.confirm) {
      setConfirmingId(option.id);
    } else {
      respondWithOption(option);
    }
  };

  const confirming =
    confirmingId != null
      ? options?.find((o) => o.id === confirmingId)
      : undefined;

  if (confirming) {
    const confirmMeta =
      typeof confirming.confirm === "object" ? confirming.confirm : undefined;
    const confirmDescription =
      confirmMeta?.description ?? confirming.description;
    const sx = stylex.props(s.approvalConfirm, style);
    const titleSx = stylex.props(s.approvalConfirmTitle);
    const descriptionSx = stylex.props(s.approvalConfirmDescription);
    const grantsSx = stylex.props(s.grants);
    const grantSx = stylex.props(s.grant);
    return (
      <div
        data-slot="tool-fallback-approval-confirm"
        {...props}
        className={`aui-tool-fallback-approval-confirm ${sx.className ?? ""}`}
        style={sx.style}
      >
        <p
          className={`aui-tool-fallback-approval-confirm-title ${titleSx.className ?? ""}`}
          style={titleSx.style}
        >
          {confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
        </p>
        {confirmDescription && (
          <p
            className={`aui-tool-fallback-approval-confirm-description ${descriptionSx.className ?? ""}`}
            style={descriptionSx.style}
          >
            {confirmDescription}
          </p>
        )}
        {confirming.grants && confirming.grants.length > 0 && (
          <ul
            className={`aui-tool-fallback-approval-confirm-grants ${grantsSx.className ?? ""}`}
            style={grantsSx.style}
          >
            {confirming.grants.map((grant) => (
              <li key={grant}>
                <code
                  className={`aui-tool-fallback-approval-confirm-grant ${grantSx.className ?? ""}`}
                  style={grantSx.style}
                >
                  {grant}
                </code>
              </li>
            ))}
          </ul>
        )}
        <div {...stylex.props(s.buttonRow)}>
          <Button
            size="sm"
            sx={s.pressable}
            onClick={() => respondWithOption(confirming)}
            disabled={submitted}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            sx={s.pressable}
            onClick={() => setConfirmingId(null)}
            disabled={submitted}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (declaredOptions && declaredOptions.length > 0) {
    const allowOptions = options?.filter((o) => isAllowKind(o.kind)) ?? [];
    const rejectOptions = options?.filter((o) => !isAllowKind(o.kind)) ?? [];
    const sx = stylex.props(s.approvalRow, s.approvalRowWrap, style);
    return (
      <div
        data-slot="tool-fallback-approval"
        {...props}
        className={`aui-tool-fallback-approval ${sx.className ?? ""}`}
        style={sx.style}
      >
        {[...allowOptions, ...rejectOptions].map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option === allowOptions[0] ? "default" : "outline"}
            sx={s.pressable}
            onClick={() => handleOption(option)}
            disabled={submitted}
          >
            {approvalOptionLabel(option)}
          </Button>
        ))}
        {rejectOptions.length === 0 && (
          <Button
            size="sm"
            variant="outline"
            sx={s.pressable}
            onClick={() => respond(false)}
            disabled={submitted}
          >
            Deny
          </Button>
        )}
      </div>
    );
  }

  const sx = stylex.props(s.approvalRow, style);

  return (
    <div
      data-slot="tool-fallback-approval"
      {...props}
      className={`aui-tool-fallback-approval ${sx.className ?? ""}`}
      style={sx.style}
    >
      <Button
        size="sm"
        sx={s.pressable}
        onClick={() => respond(true)}
        disabled={submitted}
      >
        Allow
      </Button>
      <Button
        size="sm"
        variant="outline"
        sx={s.pressable}
        onClick={() => respond(false)}
        disabled={submitted}
      >
        Deny
      </Button>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval
}) => {
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";
  const isRequiresAction = status?.type === "requires-action";

  const [open, setOpen] = useState(isRequiresAction);
  const [prevRequiresAction, setPrevRequiresAction] =
    useState(isRequiresAction);
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction);
    if (isRequiresAction) setOpen(true);
  }

  return (
    <ToolFallbackRoot open={open} onOpenChange={setOpen}>
      <ToolFallbackTrigger toolName={toolName} status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs
          argsText={argsText}
          style={isCancelled ? s.cancelled : undefined}
        />
        {isRequiresAction && (
          <ToolFallbackApproval
            addResult={addResult}
            resume={resume}
            interrupt={interrupt}
            approval={approval}
            respondToApproval={respondToApproval}
          />
        )}
        {!isCancelled && <ToolFallbackResult result={result} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const ToolFallback = memo(
  ToolFallbackImpl,
) as unknown as ToolCallMessagePartComponent & {
  Root: typeof ToolFallbackRoot;
  Trigger: typeof ToolFallbackTrigger;
  Content: typeof ToolFallbackContent;
  Args: typeof ToolFallbackArgs;
  Result: typeof ToolFallbackResult;
  Error: typeof ToolFallbackError;
  Approval: typeof ToolFallbackApproval;
};

ToolFallback.displayName = "ToolFallback";
ToolFallback.Root = ToolFallbackRoot;
ToolFallback.Trigger = ToolFallbackTrigger;
ToolFallback.Content = ToolFallbackContent;
ToolFallback.Args = ToolFallbackArgs;
ToolFallback.Result = ToolFallbackResult;
ToolFallback.Error = ToolFallbackError;
ToolFallback.Approval = ToolFallbackApproval;

export {
  ToolFallback,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
  ToolFallbackApproval
};
