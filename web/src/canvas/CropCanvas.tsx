// Crop rectangle editor over the original upload: 4 corner + 4 edge handles, dimmed outside, drag to move,
// drag outside the box to draw a new one. Crop values are integers in ORIGINAL image pixels.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CropRect } from "../lib/types";
import { cssVar } from "../lib/theme";
import { Spinner } from "../components/ui";

type Handle = "tl" | "tr" | "br" | "bl" | "t" | "r" | "b" | "l" | "move" | "new";

interface Props {
  imageUrl: string | null;
  /** Called on every change; `commit` is true when the pointer is released. */
  crop: CropRect | null;
  onChange: (crop: CropRect, commit: boolean) => void;
  onImageSize?: (size: { width: number; height: number }) => void;
  disabled?: boolean;
}

const MIN = 24; // px in image space

export function clampCrop(c: CropRect, imgW: number, imgH: number): CropRect {
  const width = Math.max(MIN, Math.min(imgW, Math.round(c.width)));
  const height = Math.max(MIN, Math.min(imgH, Math.round(c.height)));
  const x = Math.max(0, Math.min(imgW - width, Math.round(c.x)));
  const y = Math.max(0, Math.min(imgH - height, Math.round(c.y)));
  return { x, y, width, height };
}

export default function CropCanvas({ imageUrl, crop, onChange, onImageSize, disabled }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [theme, setTheme] = useState(0);
  const dragRef = useRef<{ handle: Handle; start: { x: number; y: number }; orig: CropRect } | null>(null);
  const [activeHandle, setActiveHandle] = useState<Handle | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onTheme = () => setTheme((t) => t + 1);
    window.addEventListener("soraplan:theme", onTheme);
    return () => window.removeEventListener("soraplan:theme", onTheme);
  }, []);

  useEffect(() => {
    setImg(null);
    setFailed(false);
    if (!imageUrl) return;
    const i = new Image();
    i.onload = () => {
      setImg(i);
      onImageSize?.({ width: i.naturalWidth, height: i.naturalHeight });
    };
    i.onerror = () => setFailed(true);
    i.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Image → screen fit
  const layout = useCallback(() => {
    if (!img || size.w <= 0) return null;
    const pad = 24;
    const padTop = 48; // room for the size readout so it never covers the top handles
    const s = Math.min((size.w - pad * 2) / img.naturalWidth, (size.h - pad - padTop) / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    return { s, ox: (size.w - dw) / 2, oy: padTop + (size.h - pad - padTop - dh) / 2, dw, dh };
  }, [img, size]);

  const current: CropRect | null = img ? crop || { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight } : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const L = layout();
    if (!canvas || !L || !img || !current) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.drawImage(img, L.ox, L.oy, L.dw, L.dh);

    const bx = L.ox + current.x * L.s;
    const by = L.oy + current.y * L.s;
    const bw = current.width * L.s;
    const bh = current.height * L.s;

    // Dim outside (even-odd path)
    ctx.save();
    ctx.fillStyle = cssVar("--text", "#000");
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.rect(L.ox, L.oy, L.dw, L.dh);
    ctx.rect(bx, by, bw, bh);
    ctx.fill("evenodd");
    ctx.restore();

    const accent = cssVar("--accent", "#36f");
    const surface = cssVar("--surface", "#fff");
    // Thirds
    ctx.save();
    ctx.strokeStyle = surface;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(bx + (bw * i) / 3, by);
      ctx.lineTo(bx + (bw * i) / 3, by + bh);
      ctx.moveTo(bx, by + (bh * i) / 3);
      ctx.lineTo(bx + bw, by + (bh * i) / 3);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);

    // Corner brackets
    const len = Math.min(22, bw / 3, bh / 3);
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = surface;
    const corners: [number, number, number, number][] = [
      [bx, by, 1, 1],
      [bx + bw, by, -1, 1],
      [bx + bw, by + bh, -1, -1],
      [bx, by + bh, 1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * len);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * len);
      ctx.stroke();
    }
    // Edge pills
    const pills: [Handle, number, number, number, number][] = [
      ["t", bx + bw / 2, by, 22, 6],
      ["b", bx + bw / 2, by + bh, 22, 6],
      ["l", bx, by + bh / 2, 6, 22],
      ["r", bx + bw, by + bh / 2, 6, 22],
    ];
    for (const [h, x, y, w, hh] of pills) {
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - hh / 2, w, hh, 3);
      ctx.fillStyle = activeHandle === h ? accent : surface;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [img, size, current?.x, current?.y, current?.width, current?.height, layout, activeHandle, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAt = (sx: number, sy: number): Handle | null => {
    const L = layout();
    if (!L || !current) return null;
    const bx = L.ox + current.x * L.s;
    const by = L.oy + current.y * L.s;
    const bw = current.width * L.s;
    const bh = current.height * L.s;
    const R = 14;
    const near = (x: number, y: number) => Math.hypot(sx - x, sy - y) <= R;
    if (near(bx, by)) return "tl";
    if (near(bx + bw, by)) return "tr";
    if (near(bx + bw, by + bh)) return "br";
    if (near(bx, by + bh)) return "bl";
    const inX = sx > bx && sx < bx + bw;
    const inY = sy > by && sy < by + bh;
    if (inX && Math.abs(sy - by) <= 9) return "t";
    if (inX && Math.abs(sy - (by + bh)) <= 9) return "b";
    if (inY && Math.abs(sx - bx) <= 9) return "l";
    if (inY && Math.abs(sx - (bx + bw)) <= 9) return "r";
    if (inX && inY) return "move";
    return "new";
  };

  const toImage = (sx: number, sy: number) => {
    const L = layout()!;
    return { x: (sx - L.ox) / L.s, y: (sy - L.oy) / L.s };
  };

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const cursorFor = (h: Handle | null) =>
    ({ tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize", move: "move", new: "crosshair" } as Record<string, string>)[h || ""] || "default";

  const compute = (h: Handle, o: CropRect, start: { x: number; y: number }, p: { x: number; y: number }): CropRect => {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    let { x, y, width, height } = o;
    const right = o.x + o.width;
    const bottom = o.y + o.height;
    if (h === "move") return clampCrop({ x: o.x + dx, y: o.y + dy, width, height }, img!.naturalWidth, img!.naturalHeight);
    if (h === "new") {
      const ax = Math.max(0, Math.min(img!.naturalWidth, start.x));
      const ay = Math.max(0, Math.min(img!.naturalHeight, start.y));
      const px = Math.max(0, Math.min(img!.naturalWidth, p.x));
      const py = Math.max(0, Math.min(img!.naturalHeight, p.y));
      return clampCrop({ x: Math.min(ax, px), y: Math.min(ay, py), width: Math.abs(px - ax), height: Math.abs(py - ay) }, img!.naturalWidth, img!.naturalHeight);
    }
    if (h.includes("l")) {
      x = Math.max(0, Math.min(right - MIN, o.x + dx));
      width = right - x;
    }
    if (h.includes("r")) width = Math.max(MIN, Math.min(img!.naturalWidth - o.x, o.width + dx));
    if (h.includes("t")) {
      y = Math.max(0, Math.min(bottom - MIN, o.y + dy));
      height = bottom - y;
    }
    if (h.includes("b")) height = Math.max(MIN, Math.min(img!.naturalHeight - o.y, o.height + dy));
    return clampCrop({ x, y, width, height }, img!.naturalWidth, img!.naturalHeight);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !current) return;
    const { sx, sy } = local(e);
    const h = handleAt(sx, sy);
    if (!h) return;
    dragRef.current = { handle: h, start: toImage(sx, sy), orig: current };
    setActiveHandle(h);
    canvasRef.current!.setPointerCapture(e.pointerId);
  };
  const lastRef = useRef<CropRect | null>(null);
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = local(e);
    const d = dragRef.current;
    if (!d) {
      canvasRef.current!.style.cursor = disabled ? "default" : cursorFor(handleAt(sx, sy));
      return;
    }
    const next = compute(d.handle, d.orig, d.start, toImage(sx, sy));
    lastRef.current = next;
    onChange(next, false);
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    try {
      canvasRef.current!.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
    setActiveHandle(null);
    if (lastRef.current) onChange(lastRef.current, true);
    lastRef.current = null;
  };

  return (
    <div className="crop-stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {!img && (
        <div className="crop-loading">
          {failed ? "Could not load the image" : <span><Spinner /> Loading image…</span>}
        </div>
      )}
      {img && current && (
        <div className="crop-readout">
          <span className="mono">
            {current.width} × {current.height} px · {Math.round(((current.width * current.height) / (img.naturalWidth * img.naturalHeight)) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
