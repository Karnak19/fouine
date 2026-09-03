"use client";

import { memo, type FC } from "react";
import * as stylex from "@stylexjs/stylex";
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
  BracesIcon,
  DownloadIcon
} from "lucide-react";
import type { FileMessagePartComponent } from "@assistant-ui/react";
import { color, leading, radius, space, text } from "@/tokens.stylex";
import { shared } from "@/styles";

const s = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.x12,
    borderRadius: radius.lg,
    borderWidth: 0,
    borderStyle: "solid",
    transitionProperty: "color, background-color, border-color",
    transitionDuration: "150ms"
  },

  icon: { color: color.mutedForeground, flexShrink: 0 },
  icon5: { height: space.x20, width: space.x20 },

  name: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500
  },

  size: { color: color.mutedForeground, flexShrink: 0 },
  sizeXs: { fontSize: text.xs, lineHeight: leading.xs },

  download: {
    color: { default: color.mutedForeground, ":hover": color.accentForeground },
    backgroundColor: { default: null, ":hover": color.accent },
    flexShrink: 0,
    borderRadius: radius.md,
    padding: space.x4,
    transitionProperty: "color, background-color",
    transitionDuration: "150ms"
  },

  meta: {
    display: "flex",
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    flexDirection: "column",
    gap: space.x2
  }
});

const rootVariants = stylex.create({
  outline: {
    borderWidth: "1px",
    borderColor: color.border,
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.muted} 50%, transparent)`
    }
  },
  ghost: {
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.muted} 50%, transparent)`
    }
  },
  muted: {
    backgroundColor: {
      default: `color-mix(in oklab, ${color.muted} 50%, transparent)`,
      ":hover": `color-mix(in oklab, ${color.muted} 70%, transparent)`
    }
  }
});

const rootSizes = stylex.create({
  sm: { paddingInline: space.x10, paddingBlock: space.x6, fontSize: text.xs, lineHeight: leading.xs },
  default: { paddingInline: space.x12, paddingBlock: space.x8, fontSize: text.sm, lineHeight: leading.sm },
  lg: { paddingInline: space.x16, paddingBlock: space.x12, fontSize: text.base, lineHeight: leading.base }
});

export type FileRootVariant = keyof typeof rootVariants;
export type FileRootSize = keyof typeof rootSizes;

function getMimeTypeIcon(
  mimeType: string,
): FC<{ className?: string; style?: React.CSSProperties }> {
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) {
    return ImageIcon;
  }
  if (type === "application/pdf") {
    return FileTextIcon;
  }
  if (type === "application/json") {
    return BracesIcon;
  }
  if (type.startsWith("text/")) {
    return FileTextIcon;
  }
  if (type.startsWith("audio/")) {
    return MusicIcon;
  }
  if (type.startsWith("video/")) {
    return VideoIcon;
  }
  return FileIcon;
}

export type FileDataKind = "data-uri" | "url" | "base64" | "id";

function getFileDataKind(
  data: string,
  sourceType?: "url" | "id",
): FileDataKind {
  if (sourceType === "url" && /^data:/i.test(data)) return "data-uri";
  if (sourceType) return sourceType;
  if (/^data:/i.test(data)) return "data-uri";
  if (/^https?:\/\//i.test(data)) return "url";
  return "base64";
}

function getBase64Size(base64: string): number {
  const commaIndex = base64.indexOf(",");
  const base64Data = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
  const padding = (base64Data.match(/=/g) || []).length;
  return Math.floor((base64Data.length * 3) / 4) - padding;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileRootProps = Omit<
  React.ComponentProps<"div">,
  "className" | "style"
> & {
  variant?: FileRootVariant;
  size?: FileRootSize;
  style?: stylex.StyleXStyles;
};

function FileRoot({ style, variant, size, children, ...props }: FileRootProps) {
  const p = stylex.props(
    s.root,
    rootVariants[variant ?? "outline"],
    rootSizes[size ?? "default"],
    style,
  );
  return (
    <div
      data-slot="file-root"
      data-variant={variant}
      data-size={size}
      {...props}
      {...p}
      className={`aui-file-root ${p.className ?? ""}`}
    >
      {children}
    </div>
  );
}

type FileIconDisplayProps = Omit<
  React.ComponentProps<"span">,
  "className" | "style"
> & {
  mimeType?: string;
  style?: stylex.StyleXStyles;
};

function FileIconDisplay({
  mimeType,
  style,
  children,
  ...props
}: FileIconDisplayProps) {
  const IconComponent = mimeType ? getMimeTypeIcon(mimeType) : FileIcon;

  return (
    <span data-slot="file-icon" {...props} {...stylex.props(s.icon, style)}>
      {children ?? <IconComponent {...stylex.props(s.icon5)} />}
    </span>
  );
}

function FileName({
  style,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  return (
    <span data-slot="file-name" {...props} {...stylex.props(s.name, style)}>
      {children || "Unnamed file"}
    </span>
  );
}

type FileSizeProps = Omit<
  React.ComponentProps<"span">,
  "className" | "style"
> & {
  bytes: number;
  style?: stylex.StyleXStyles;
};

function FileSize({ bytes, style, ...props }: FileSizeProps) {
  return (
    <span data-slot="file-size" {...props} {...stylex.props(s.size, style)}>
      {formatFileSize(bytes)}
    </span>
  );
}

type FileDownloadProps = Omit<
  React.ComponentProps<"a">,
  "href" | "className" | "style"
> & {
  data: string;
  mimeType: string;
  filename?: string;
  sourceType?: "url" | "id";
  style?: stylex.StyleXStyles;
};

function FileDownload({
  data,
  mimeType,
  filename,
  sourceType,
  style,
  children,
  ...props
}: FileDownloadProps) {
  if (typeof data !== "string") return null;
  const kind = getFileDataKind(data, sourceType);
  if (kind === "id") return null;
  if (kind === "url" && !/^(https?:\/\/|blob:)/i.test(data)) return null;
  const href = kind === "base64" ? `data:${mimeType};base64,${data}` : data;

  return (
    <a
      data-slot="file-download"
      href={href}
      download={filename || "download"}
      {...(kind === "url" && { target: "_blank", rel: "noopener noreferrer" })}
      {...props}
      {...stylex.props(s.download, style)}
    >
      {children || <DownloadIcon {...stylex.props(shared.icon)} />}
    </a>
  );
}

const FileImpl: FileMessagePartComponent = ({
  filename,
  data,
  mimeType,
  sourceType
}) => {
  const kind = getFileDataKind(data, sourceType);
  const showSize =
    typeof data === "string" && (kind === "base64" || kind === "data-uri");

  return (
    <FileRoot>
      <FileIconDisplay mimeType={mimeType} />
      <div {...stylex.props(s.meta)}>
        <FileName>{filename}</FileName>
        {showSize && <FileSize bytes={getBase64Size(data)} style={s.sizeXs} />}
      </div>
      <FileDownload
        data={data}
        mimeType={mimeType}
        {...(filename !== undefined && { filename })}
        {...(sourceType !== undefined && { sourceType })}
      />
    </FileRoot>
  );
};

const File = memo(FileImpl) as unknown as FileMessagePartComponent & {
  Root: typeof FileRoot;
  Icon: typeof FileIconDisplay;
  Name: typeof FileName;
  Size: typeof FileSize;
  Download: typeof FileDownload;
};

File.displayName = "File";
File.Root = FileRoot;
File.Icon = FileIconDisplay;
File.Name = FileName;
File.Size = FileSize;
File.Download = FileDownload;

export {
  File,
  FileRoot,
  FileIconDisplay,
  FileName,
  FileSize,
  FileDownload,
  getMimeTypeIcon,
  getFileDataKind,
  getBase64Size,
  formatFileSize
};
