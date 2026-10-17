// Small shared UI primitives. Styling lives in styles/global.css (class names below).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        {title && (
          <div className="dialog__head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** In-page confirmation (never window.confirm). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  danger = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Dialog>
  );
}

/** ⋮ menu: `items` render as buttons; closes on outside click. */
export function Menu({
  items,
  label = "More",
  className = "",
}: {
  items: { label: string; onClick: () => void; danger?: boolean; hidden?: boolean }[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div className={`menu ${className}`} ref={ref}>
      <button
        className="icon-btn"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Icon name="dots" />
      </button>
      {open && (
        <div className="menu__list" role="menu">
          {visible.map((i) => (
            <button
              key={i.label}
              role="menuitem"
              className={i.danger ? "danger" : ""}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                i.onClick();
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type IconName =
  | "plus" | "close" | "dots" | "send" | "stop" | "attach" | "sun" | "moon" | "logout" | "box" | "chat"
  | "menu" | "undo" | "redo" | "trash" | "upload" | "check" | "back" | "search" | "cube" | "rotate"
  | "fit" | "zoomIn" | "zoomOut" | "lock" | "unlock" | "grid" | "image" | "sidebar" | "swap" | "layers" | "move" | "expand";

const PATHS: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  dots: "M12 5.5h.01M12 12h.01M12 18.5h.01",
  send: "M5 12h14M13 6l6 6-6 6",
  stop: "M7 7h10v10H7z",
  attach: "M21 11.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.3",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 100-8 4 4 0 000 8z",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  logout: "M15 4h4v16h-4M10 17l5-5-5-5M15 12H3",
  box: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  chat: "M4 5h16v11H8l-4 4z",
  menu: "M4 6h16M4 12h16M4 18h16",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  check: "M5 12l5 5 9-10",
  back: "M15 6l-6 6 6 6",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4",
  cube: "M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10",
  rotate: "M20 12a8 8 0 11-2.3-5.7M20 4v5h-5",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  zoomIn: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8 11h6M11 8v6",
  zoomOut: "M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8 11h6",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3",
  unlock: "M6 11h12v9H6zM8 11V8a4 4 0 017.5-2",
  grid: "M4 4h16v16H4zM4 12h16M12 4v16",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  sidebar: "M4 5h16v14H4zM9 5v14",
  swap: "M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5",
  move: "M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Image viewer: call viewImage(src, caption) from anywhere; <ImageViewerHost /> is mounted once in App. */
type ViewedImage = { src: string; alt: string };
let showImage: ((img: ViewedImage | null) => void) | null = null;
export function viewImage(src: string, alt = "") {
  showImage?.({ src, alt });
}
export function ImageViewerHost() {
  const [img, setImg] = useState<ViewedImage | null>(null);
  useEffect(() => {
    showImage = setImg;
    return () => {
      showImage = null;
    };
  }, []);
  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setImg(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [img]);
  if (!img) return null;
  return createPortal(
    <div className="viewer-backdrop" role="dialog" aria-modal="true" aria-label={img.alt || "Image"} onClick={() => setImg(null)}>
      <button className="icon-btn viewer-backdrop__close" onClick={() => setImg(null)} aria-label="Close">
        <Icon name="close" />
      </button>
      <figure className="viewer-figure" onClick={(e) => e.stopPropagation()}>
        <img src={img.src} alt={img.alt} />
        {img.alt && <figcaption>{img.alt}</figcaption>}
      </figure>
    </div>,
    document.body,
  );
}
/** An image that opens in the viewer when clicked. `alt` doubles as the viewer caption. */
export function ZoomableImage({ src, alt, className, loading }: { src: string; alt: string; className?: string; loading?: "lazy" | "eager" }) {
  return (
    <button type="button" className={`zoomable ${className || ""}`} onClick={() => viewImage(src, alt)} aria-label={`View ${alt || "image"} larger`}>
      <img src={src} alt={alt} loading={loading} />
    </button>
  );
}

/** Toasts: call toast("Saved") from anywhere. */
type Toast = { id: number; text: string; tone: "info" | "error" | "success" };
let pushToast: ((t: Toast) => void) | null = null;
let toastSeq = 0;
export function toast(text: string, tone: Toast["tone"] = "info") {
  pushToast?.({ id: ++toastSeq, text, tone });
}
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 4200);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return createPortal(
    <div className="toaster" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>{t.text}</div>
      ))}
    </div>,
    document.body,
  );
}
