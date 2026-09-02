"use client";

import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayButton } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { color, leading, radius, space, text } from "@/tokens.stylex";

// react-day-picker takes a `classNames` map of slot -> class string, so every
// StyleX rule for a slot has to be flattened back into a class name here. The
// `defaultClassNames.*` value is kept alongside ours: those are day-picker's own
// `rdp-*` hooks, vendored classes like `shimmer`, not ours to remove.
// `DayPickerProps` is a discriminated union on `mode`. A non-distributive
// `Omit<...>` collapses it into one object and TS can no longer assign it back
// to the union, so the omit has to distribute.
type OmitClassStyle<T> = T extends unknown ? Omit<T, "className" | "style"> : never;

const rdp = (defaultClass: string, style: stylex.StyleXStyles) =>
  `${defaultClass} ${stylex.props(style).className ?? ""}`.trim();

// The cell size was a local CSS var, `[--cell-size:--spacing(8)]` === 2rem.
// StyleX can only declare vars in a *.stylex.ts file, so the token is inlined.
const s = stylex.create({
  root: {
    backgroundColor: color.background,
    padding: space.x12
  },
  rootSlot: { width: "fit-content" },
  months: {
    position: "relative",
    display: "flex",
    flexDirection: { default: "column", "@media (min-width: 768px)": "row" },
    gap: space.x16
  },
  month: { display: "flex", width: "100%", flexDirection: "column", gap: space.x16 },
  nav: {
    position: "absolute",
    insetInline: 0,
    top: 0,
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.x4
  },
  navButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x8,
    borderRadius: radius.md,
    borderWidth: 0,
    borderStyle: "solid",
    fontSize: text.sm, lineHeight: leading.sm,
    fontWeight: 500,
    transitionProperty: "color, background-color",
    transitionDuration: "150ms",
    cursor: "pointer",
    width: space.x32,
    height: space.x32,
    padding: space.x0,
    userSelect: "none",
    opacity: { default: null, ":disabled": 0.5, '[aria-disabled="true"]': 0.5 },
    pointerEvents: { default: null, ":disabled": "none" }
  },
  monthCaption: {
    display: "flex",
    height: space.x32,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingInline: space.x32
  },
  dropdowns: {
    display: "flex",
    height: space.x32,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x6,
    fontSize: text.sm, lineHeight: leading.sm,
    fontWeight: 500
  },
  dropdownRoot: {
    position: "relative",
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: color.input, ":has(:focus)": color.ring },
    boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    outlineWidth: { default: 0, ":has(:focus)": "3px" },
    outlineStyle: "solid",
    outlineColor: color.ring
  },
  dropdown: {
    position: "absolute",
    inset: 0,
    backgroundColor: color.popover,
    opacity: 0
  },
  captionLabel: { fontWeight: 500, userSelect: "none" },
  captionLabelText: { fontSize: text.sm, lineHeight: leading.sm },
  captionLabelDropdown: {
    display: "flex",
    height: space.x32,
    alignItems: "center",
    gap: space.x4,
    borderRadius: radius.md,
    paddingRight: space.x4,
    paddingLeft: space.x8,
    fontSize: text.sm, lineHeight: leading.sm
  },
  monthGrid: { width: "100%", borderCollapse: "collapse" },
  weekdays: { display: "flex" },
  weekday: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    borderRadius: radius.md,
    fontSize: text.xsPlus,
    fontWeight: 400,
    color: color.mutedForeground,
    userSelect: "none"
  },
  week: { marginTop: space.x8, display: "flex", width: "100%" },
  weekNumberHeader: { width: space.x32, userSelect: "none" },
  weekNumber: { fontSize: text.xsPlus, color: color.mutedForeground, userSelect: "none" },
  weekNumberCell: {
    display: "flex",
    width: space.x32,
    height: space.x32,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center"
  },
  day: {
    position: "relative",
    aspectRatio: 1,
    height: "100%",
    width: "100%",
    padding: space.x0,
    textAlign: "center",
    userSelect: "none"
  },
  rangeStart: {
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
    backgroundColor: color.accent
  },
  rangeMiddle: { borderRadius: "0" },
  rangeEnd: {
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: color.accent
  },
  today: {
    borderRadius: { default: radius.md, '[data-selected="true"]': "0" },
    backgroundColor: color.accent,
    color: color.accentForeground
  },
  outside: { color: color.mutedForeground },
  disabled: { color: color.mutedForeground, opacity: 0.5 },
  hidden: { visibility: "hidden" },
  chevron: { width: space.x16, height: space.x16 }
});

const navVariants = stylex.create({
  ghost: { backgroundColor: { default: "transparent", ":hover": color.zinc800 } },
  outline: {
    borderWidth: "1px",
    borderColor: color.zinc700,
    backgroundColor: { default: "transparent", ":hover": color.zinc800 }
  }
});

const dayButton = stylex.create({
  base: {
    display: "flex",
    aspectRatio: 1,
    height: "auto",
    width: "100%",
    minWidth: space.x32,
    flexDirection: "column",
    gap: space.x4,
    lineHeight: 1,
    fontWeight: 400,
    borderRadius: {
      default: null,
      '[data-range-end="true"]': radius.md,
      '[data-range-middle="true"]': "0",
      '[data-range-start="true"]': radius.md
    },
    backgroundColor: {
      default: null,
      '[data-range-end="true"]': color.primary,
      '[data-range-middle="true"]': color.accent,
      '[data-range-start="true"]': color.primary,
      '[data-selected-single="true"]': color.primary
    },
    color: {
      default: null,
      '[data-range-end="true"]': color.primaryForeground,
      '[data-range-middle="true"]': color.accentForeground,
      '[data-range-start="true"]': color.primaryForeground,
      '[data-selected-single="true"]': color.primaryForeground
    }
  }
});

function Calendar({
  style,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: OmitClassStyle<React.ComponentProps<typeof DayPicker>> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  style?: stylex.StyleXStyles;
}) {
  const defaultClassNames = getDefaultClassNames();
  const navVariant = navVariants[buttonVariant === "outline" ? "outline" : "ghost"];

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={stylex.props(s.root, style).className}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
        ...formatters
      }}
      classNames={{
        root: rdp(defaultClassNames.root, s.rootSlot),
        months: rdp(defaultClassNames.months, s.months),
        month: rdp(defaultClassNames.month, s.month),
        nav: rdp(defaultClassNames.nav, s.nav),
        button_previous: rdp(defaultClassNames.button_previous, [s.navButton, navVariant]),
        button_next: rdp(defaultClassNames.button_next, [s.navButton, navVariant]),
        month_caption: rdp(defaultClassNames.month_caption, s.monthCaption),
        dropdowns: rdp(defaultClassNames.dropdowns, s.dropdowns),
        dropdown_root: rdp(defaultClassNames.dropdown_root, s.dropdownRoot),
        dropdown: rdp(defaultClassNames.dropdown, s.dropdown),
        caption_label: rdp(defaultClassNames.caption_label, [
          s.captionLabel,
          captionLayout === "label" ? s.captionLabelText : s.captionLabelDropdown,
        ]),
        month_grid: rdp(defaultClassNames.month_grid, s.monthGrid),
        weekdays: rdp(defaultClassNames.weekdays, s.weekdays),
        weekday: rdp(defaultClassNames.weekday, s.weekday),
        week: rdp(defaultClassNames.week, s.week),
        week_number_header: rdp(defaultClassNames.week_number_header, s.weekNumberHeader),
        week_number: rdp(defaultClassNames.week_number, s.weekNumber),
        day: rdp(defaultClassNames.day, s.day),
        range_start: rdp(defaultClassNames.range_start, s.rangeStart),
        range_middle: rdp(defaultClassNames.range_middle, s.rangeMiddle),
        range_end: rdp(defaultClassNames.range_end, s.rangeEnd),
        // Not via rdp(): `s.today` keys borderRadius on an arbitrary attribute
        // selector, so its value type is `unknown` and the narrow
        // `StyleXStyles` annotation on rdp rejects it. `stylex.props` itself
        // takes it fine, so the flattening is inlined here.
        today: `${defaultClassNames.today} ${stylex.props(s.today).className ?? ""}`.trim(),
        outside: rdp(defaultClassNames.outside, s.outside),
        disabled: rdp(defaultClassNames.disabled, s.disabled),
        hidden: rdp(defaultClassNames.hidden, s.hidden),
        ...classNames
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return <div data-slot="calendar" ref={rootRef} className={className} {...props} />;
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={rdp(className ?? "", s.chevron)} {...props} />;
          }

          if (orientation === "right") {
            return <ChevronRightIcon className={rdp(className ?? "", s.chevron)} {...props} />;
          }

          return <ChevronDownIcon className={rdp(className ?? "", s.chevron)} {...props} />;
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div {...stylex.props(s.weekNumberCell)}>{children}</div>
            </td>
          );
        },
        ...components
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className: _rdpClassName,
  style: _rdpStyle,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      // `dayButton.base` keys borderRadius/backgroundColor/color on arbitrary
      // attribute selectors, so those properties type as `unknown` and the bare
      // `stylex.StyleXStyles` on Button's `style` prop rejects them. The cast is
      // the boundary fix; loosening Button's annotation is the real one, but
      // that file is owned elsewhere.
      style={dayButton.base as stylex.StyleXStyles}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
