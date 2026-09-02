import * as React from "react";
import * as stylex from "@stylexjs/stylex";
import { color, leading, space, text } from "@/tokens.stylex";

type El<T> = { style?: stylex.StyleXStyles } & Omit<T, "className" | "style">;

const s = stylex.create({
  table: {
    width: "100%",
    captionSide: "bottom",
    fontSize: text.sm, lineHeight: leading.sm
  },
  // Was `[&_tr]:border-b [&_tr]:border-zinc-800` on the thead. StyleX cannot
  // reach descendants, so the header rule moves onto the thead itself — with
  // border-collapse the line lands on the same edge as the row border did.
  header: {
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: color.zinc800
  },
  row: {
    // `[&_tr:last-child]:border-0` used to live on the tbody; expressed here as
    // :last-child, which is why the thead carries its own border above.
    borderBottomWidth: { default: "1px", ":last-child": 0 },
    borderBottomStyle: "solid",
    borderBottomColor: color.zinc800,
    transitionProperty: "color, background-color",
    transitionDuration: "150ms",
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.zinc800} 50%, transparent)`
    }
  },
  head: {
    height: space.x40,
    paddingInline: space.x16,
    textAlign: "left",
    verticalAlign: "middle",
    fontWeight: 500,
    color: color.zinc400
  },
  cell: {
    padding: space.x16,
    verticalAlign: "middle"
  }
});

export function Table({ style, ...props }: El<React.HTMLAttributes<HTMLTableElement>>) {
  return <table {...props} {...stylex.props(s.table, style)} />;
}

export function TableHeader({
  style,
  ...props
}: El<React.HTMLAttributes<HTMLTableSectionElement>>) {
  return <thead {...props} {...stylex.props(s.header, style)} />;
}

export function TableBody({ style, ...props }: El<React.HTMLAttributes<HTMLTableSectionElement>>) {
  return <tbody {...props} {...stylex.props(style)} />;
}

export function TableRow({ style, ...props }: El<React.HTMLAttributes<HTMLTableRowElement>>) {
  return <tr {...props} {...stylex.props(s.row, style)} />;
}

export function TableHead({ style, ...props }: El<React.ThHTMLAttributes<HTMLTableCellElement>>) {
  return <th {...props} {...stylex.props(s.head, style)} />;
}

export function TableCell({ style, ...props }: El<React.TdHTMLAttributes<HTMLTableCellElement>>) {
  return <td {...props} {...stylex.props(s.cell, style)} />;
}
