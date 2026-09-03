"use client";

import {
  memo,
  useState,
  useEffect,
  useRef,
  type PropsWithChildren
} from "react";
import { createPortal } from "react-dom";
import * as stylex from "@stylexjs/stylex";
import {
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  ImageOffIcon,
  Loader2Icon,
  RefreshCwIcon,
  ShieldAlertIcon
} from "lucide-react";
import type {
  ImageMessagePart,
  ImageMessagePartComponent
} from "@assistant-ui/react";
import { color, leading, radius, space, text } from "@/tokens.stylex";
import { shared } from "@/styles";

const extensionForMimeType = (mimeType?: string): string => {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
};

const dataUriToBlob = (dataUri: string): Blob => {
  const [meta, data] = dataUri.split(",");
  const mime =
    meta?.match(/data:([^;]+)/i)?.[1]?.toLowerCase() ??
    "application/octet-stream";
  if (!/;base64/i.test(meta ?? "")) {
    return new Blob([decodeURIComponent(data ?? "")], { type: mime });
  }
  const bytes = atob(data ?? "");
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
};

const mimeFromImage = (image: string): string | undefined =>
  image.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase();

const downloadImagePart = (
  part: Pick<ImageMessagePart, "image" | "filename">,
): void => {
  if (typeof document === "undefined") return;
  const ext = extensionForMimeType(mimeFromImage(part.image));
  const filename = part.filename ?? `image.${ext}`;
  const isDataUri = /^data:/i.test(part.image);
  const objectUrl = isDataUri
    ? URL.createObjectURL(dataUriToBlob(part.image))
    : null;
  const href = objectUrl ?? part.image;
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 40_000);
};

const copyImagePart = async (
  part: Pick<ImageMessagePart, "image">,
): Promise<void> => {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error("Clipboard API is not available in this environment.");
  }
  const blob = /^data:/i.test(part.image)
    ? dataUriToBlob(part.image)
    : await fetch(part.image).then((r) => r.blob());
  const mime = mimeFromImage(part.image) ?? blob.type ?? "image/png";
  await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
};

// Tailwind's own `animate-pulse` / `animate-spin` keyframes, restated locally so
// the animation no longer depends on a utility class being generated.
const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 }
});
const spin = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" }
});

const s = stylex.create({
  root: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 0,
    borderStyle: "solid"
  },

  previewContainer: {
    position: "relative",
    // min-h-32.
    minHeight: space.x128
  },
  previewLoading: {
    backgroundColor: `color-mix(in oklab, ${color.muted} 50%, transparent)`,
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  // Shared surface for the three placeholder states (loading error, generating,
  // content-filter refusal): a muted panel that reserves the image's minimum
  // height so the thread does not jump when the real image arrives.
  placeholder: {
    backgroundColor: `color-mix(in oklab, ${color.muted} 50%, transparent)`,
    display: "flex",
    minHeight: space.x128,
    alignItems: "center",
    justifyContent: "center",
    padding: space.x16
  },
  placeholderColumn: {
    flexDirection: "column",
    gap: space.x8,
    textAlign: "center"
  },

  img: {
    display: "block",
    height: "auto",
    width: "100%",
    objectFit: "contain"
  },
  imgHidden: { visibility: "hidden" },

  filename: {
    color: color.mutedForeground,
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingInline: space.x8,
    paddingBlock: space.x6,
    fontSize: text.xs,
    lineHeight: leading.xs
  },

  zoomTrigger: { cursor: "zoom-in" },
  zoomOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // bg-black/80 — there is no black token; rgb() is not downlevelled the way
    // an oklch() literal would be.
    backgroundColor: "rgb(0 0 0 / 0.8)"
  },
  zoomContent: {
    maxHeight: "90vh",
    maxWidth: "90vw",
    cursor: "zoom-out",
    objectFit: "contain"
  },

  filterTitle: { fontSize: text.sm, lineHeight: leading.sm, fontWeight: 500, margin: 0 },
  filterReason: {
    color: color.mutedForeground,
    fontSize: text.xs,
    lineHeight: leading.xs,
    margin: 0
  },

  actions: {
    display: "flex",
    alignItems: "center",
    gap: space.x4,
    padding: space.x4
  },
  actionButton: {
    display: "inline-flex",
    // size-7.
    height: space.x28,
    width: space.x28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": color.muted },
    color: "inherit",
    cursor: "pointer",
    opacity: { default: null, ":disabled": 0.5 }
  },

  icon8: { height: space.x32, width: space.x32, color: color.mutedForeground },
  pulsing: {
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },
  spinning: {
    animationName: spin,
    animationDuration: "1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite"
  },

  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0
  }
});

const rootVariants = stylex.create({
  outline: { borderWidth: "1px", borderColor: color.border },
  ghost: {},
  muted: {
    backgroundColor: `color-mix(in oklab, ${color.muted} 50%, transparent)`
  }
});

// Max-widths, not spacing-scale values. 16rem happens to be on the scale;
// 24rem and 32rem are not, so they stay literals.
const rootSizes = stylex.create({
  sm: { maxWidth: space.x256 },
  default: { maxWidth: "24rem" },
  lg: { maxWidth: "32rem" },
  full: { width: "100%" }
});

export type ImageRootVariant = keyof typeof rootVariants;
export type ImageRootSize = keyof typeof rootSizes;

export type ImageRootProps = Omit<
  React.ComponentProps<"div">,
  "className" | "style"
> & {
  variant?: ImageRootVariant;
  size?: ImageRootSize;
  style?: stylex.StyleXStyles;
};

function ImageRoot({ style, variant, size, children, ...props }: ImageRootProps) {
  const p = stylex.props(
    s.root,
    rootVariants[variant ?? "outline"],
    rootSizes[size ?? "default"],
    style,
  );
  return (
    <div
      data-slot="image-root"
      data-variant={variant}
      data-size={size}
      {...props}
      {...p}
      className={`aui-image-root ${p.className ?? ""}`}
    >
      {children}
    </div>
  );
}

type ImagePreviewProps = Omit<
  React.ComponentProps<"img">,
  "children" | "className" | "style"
> & {
  style?: stylex.StyleXStyles;
  containerStyle?: stylex.StyleXStyles;
};

function ImagePreview({
  style,
  containerStyle,
  onLoad,
  onError,
  alt = "Image content",
  src,
  ...props
}: ImagePreviewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [errorSrc, setErrorSrc] = useState<string | undefined>(undefined);

  const loaded = loadedSrc === src;
  const error = errorSrc === src;

  useEffect(() => {
    if (
      typeof src === "string" &&
      imgRef.current?.complete &&
      imgRef.current.naturalWidth > 0
    ) {
      setLoadedSrc(src);
    }
  }, [src]);

  return (
    <div
      data-slot="image-preview"
      {...stylex.props(s.previewContainer, containerStyle)}
    >
      {!loaded && !error && (
        <div
          data-slot="image-preview-loading"
          {...stylex.props(s.previewLoading)}
        >
          <ImageIcon {...stylex.props(s.icon8, s.pulsing)} />
        </div>
      )}
      {error ? (
        <div data-slot="image-preview-error" {...stylex.props(s.placeholder)}>
          <ImageOffIcon {...stylex.props(s.icon8)} />
        </div>
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          onLoad={(e) => {
            if (typeof src === "string") setLoadedSrc(src);
            onLoad?.(e);
          }}
          onError={(e) => {
            if (typeof src === "string") setErrorSrc(src);
            onError?.(e);
          }}
          {...props}
          {...stylex.props(s.img, !loaded && s.imgHidden, style)}
        />
      )}
    </div>
  );
}

function ImageFilename({
  style,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "className" | "style"> & {
  style?: stylex.StyleXStyles;
}) {
  if (!children) return null;

  return (
    <span
      data-slot="image-filename"
      {...props}
      {...stylex.props(s.filename, style)}
    >
      {children}
    </span>
  );
}

type ImageZoomProps = PropsWithChildren<{
  src: string;
  alt?: string;
}>;

function ImageZoom({ src, alt = "Image preview", children }: ImageZoomProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleOpen = () => setIsOpen(true);
  const handleClose = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  const trigger = stylex.props(s.zoomTrigger);
  const overlay = stylex.props(s.zoomOverlay);
  const content = stylex.props(s.zoomContent);

  return (
    <>
      <div
        onClick={handleOpen}
        onKeyDown={(e) => e.key === "Enter" && handleOpen()}
        role="button"
        tabIndex={0}
        aria-label="Click to zoom image"
        {...trigger}
        className={`aui-image-zoom-trigger ${trigger.className ?? ""}`}
      >
        {children}
      </div>
      {isMounted &&
        isOpen &&
        createPortal(
          <div
            data-slot="image-zoom-overlay"
            role="button"
            tabIndex={0}
            onClick={handleClose}
            onKeyDown={(e) => e.key === "Enter" && handleClose()}
            aria-label="Close zoomed image"
            {...overlay}
            className={`aui-image-zoom-overlay ${overlay.className ?? ""}`}
          >
            <img
              data-slot="image-zoom-content"
              src={src}
              alt={alt}
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              {...content}
              className={`aui-image-zoom-content ${content.className ?? ""}`}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function ImageGenerating({ style }: { style?: stylex.StyleXStyles }) {
  return (
    <div
      data-slot="image-generating"
      {...stylex.props(s.placeholder, style)}
    >
      <Loader2Icon {...stylex.props(s.icon8, s.spinning)} />
      <span {...stylex.props(s.srOnly)}>Generating image…</span>
    </div>
  );
}

function ImageContentFilterError({
  style,
  reason
}: {
  style?: stylex.StyleXStyles;
  reason?: string;
}) {
  return (
    <div
      data-slot="image-content-filter-error"
      {...stylex.props(s.placeholder, s.placeholderColumn, style)}
    >
      <ShieldAlertIcon {...stylex.props(s.icon8)} />
      <p {...stylex.props(s.filterTitle)}>Image could not be generated</p>
      {reason && <p {...stylex.props(s.filterReason)}>{reason}</p>}
    </div>
  );
}

export type ImageActionsProps = {
  part: ImageMessagePart;
  /**
   * Wire to your own generation call to show a regenerate button. The button
   * renders only when this is set and the part carries a `prompt`.
   */
  onRegenerate?: () => void | Promise<void>;
  style?: stylex.StyleXStyles;
};

function RegenerateButton({
  onRegenerate
}: {
  onRegenerate: () => void | Promise<void>;
}) {
  const [isRegenerating, setIsRegenerating] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setIsRegenerating(true);
        try {
          await onRegenerate();
        } finally {
          setIsRegenerating(false);
        }
      }}
      disabled={isRegenerating}
      data-slot="image-regenerate"
      aria-label="Regenerate image"
      {...stylex.props(s.actionButton)}
    >
      <RefreshCwIcon
        {...stylex.props(shared.icon, isRegenerating && s.spinning)}
      />
    </button>
  );
}

function ImageActions({ part, onRegenerate, style }: ImageActionsProps) {
  return (
    <div data-slot="image-actions" {...stylex.props(s.actions, style)}>
      <button
        type="button"
        onClick={() => downloadImagePart(part)}
        data-slot="image-download"
        aria-label="Download image"
        {...stylex.props(s.actionButton)}
      >
        <DownloadIcon {...stylex.props(shared.icon)} />
      </button>
      <button
        type="button"
        onClick={() => {
          copyImagePart(part).catch(() => {});
        }}
        data-slot="image-copy"
        aria-label="Copy image"
        {...stylex.props(s.actionButton)}
      >
        <CopyIcon {...stylex.props(shared.icon)} />
      </button>
      {onRegenerate && <RegenerateButton onRegenerate={onRegenerate} />}
    </div>
  );
}

const ImageImpl: ImageMessagePartComponent = (props) => {
  const { image, filename, status } = props;

  if (status?.type === "running") {
    return (
      <ImageRoot>
        <ImageGenerating />
        <ImageFilename>{filename}</ImageFilename>
      </ImageRoot>
    );
  }

  if (status?.type === "incomplete" && status.reason === "content-filter") {
    return (
      <ImageRoot>
        <ImageContentFilterError reason="The provider blocked this image." />
      </ImageRoot>
    );
  }

  return (
    <ImageRoot>
      <ImageZoom src={image} alt={filename || "Image content"}>
        <ImagePreview src={image} alt={filename || "Image content"} />
      </ImageZoom>
      <ImageFilename>{filename}</ImageFilename>
    </ImageRoot>
  );
};

const Image = memo(ImageImpl) as unknown as ImageMessagePartComponent & {
  Root: typeof ImageRoot;
  Preview: typeof ImagePreview;
  Filename: typeof ImageFilename;
  Zoom: typeof ImageZoom;
  Actions: typeof ImageActions;
  Generating: typeof ImageGenerating;
  ContentFilterError: typeof ImageContentFilterError;
};

Image.displayName = "Image";
Image.Root = ImageRoot;
Image.Preview = ImagePreview;
Image.Filename = ImageFilename;
Image.Zoom = ImageZoom;
Image.Actions = ImageActions;
Image.Generating = ImageGenerating;
Image.ContentFilterError = ImageContentFilterError;

export {
  Image,
  ImageRoot,
  ImagePreview,
  ImageFilename,
  ImageZoom,
  ImageActions,
  ImageGenerating,
  ImageContentFilterError
};
