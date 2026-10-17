// React host for the plan canvas: DPR-aware <canvas>, pointer/wheel input, HTML overlay layer.
// All geometry lives in pure modules (view, hitTest, interactions, render).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isWall, type BoxObj, type EditorObject } from "./model";
import { fitView, scaleOf, toScreen, toWorld, zoomAt, type View } from "./view";
import { handleAt, hitTest, rectHandleAt, resizeCursor, type LayerVisibility } from "./hitTest";
import {
  dragWallEnd,
  moveBox,
  moveWall,
  replaceObject,
  resizeBox,
  rotateBox,
  scaleFootprint,
  type Drag,
} from "./interactions";
import { boxFromDrag } from "./AddBoxTool";
import { drawPlan, readPalette, type Decoration, type DrawState, type Palette } from "./render";
import "./planEditor.css";

export interface PlanCanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

export interface PlanCanvasProps {
  plan: DrawState["plan"];
  objects: EditorObject[];
  mode: "edit" | "mapping";
  tool?: "select" | "addBox";
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  layers: LayerVisibility;
  overlayUrl?: string | null;
  overlayOpacity: number;
  /** Edit mode: live updates while dragging (commit=false) and the final state on release (commit=true). */
  onObjectsChange?: (objects: EditorObject[], commit: boolean) => void;
  /** Add-box tool: a rectangle (plan units) was drawn; `anchor` is its bottom-center in canvas px. */
  onAddRect?: (rect: { x: number; y: number; w: number; h: number }, anchor: { x: number; y: number }) => void;
  /** Mapping mode decorations per box id. */
  decorations?: Record<string, Decoration>;
  /** Animate (pulse) missing boxes. */
  animate?: boolean;
  /** Mapping mode: footprint resized with a handle (plan units). `factor` is set for uniform (locked) scaling. */
  onFootprintChange?: (id: string, w: number, d: number, factor: number | null, commit: boolean) => void;
  footprintLock?: boolean;
  controlsRef?: React.MutableRefObject<PlanCanvasControls | null>;
  /** HTML elements over the canvas (chips); receives a world→canvas px projector. */
  renderOverlay?: (project: (wx: number, wy: number) => { x: number; y: number }, scale: number) => ReactNode;
  onPointerWorld?: (pt: { x: number; y: number } | null) => void;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function PlanCanvas(props: PlanCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [addRect, setAddRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [palette, setPalette] = useState<Palette>(() => readPalette());
  const [overlayImg, setOverlayImg] = useState<HTMLImageElement | null>(null);

  const propsRef = useRef(props);
  propsRef.current = props;
  const dragRef = useRef<Drag | null>(null);
  const lastObjectsRef = useRef<EditorObject[] | null>(null);
  const lastFootprintRef = useRef<{ w: number; d: number; factor: number | null } | null>(null);
  const pulseRef = useRef(0);

  // ---- size & DPR
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

  const { width: planW, height: planH } = props.plan;
  const fit = useCallback(() => {
    if (size.w > 0 && size.h > 0) setView(fitView(planW, planH, size.w, size.h));
  }, [planW, planH, size.w, size.h]);

  // Refit base scale on resize / plan size change, keep the user's zoom & pan.
  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    setView((prev) => {
      const f = fitView(planW, planH, size.w, size.h);
      return prev ? { ...f, zoom: prev.zoom, panX: prev.panX, panY: prev.panY } : f;
    });
  }, [planW, planH, size.w, size.h]);

  useEffect(() => {
    if (!props.controlsRef) return;
    props.controlsRef.current = {
      zoomIn: () => setView((v) => (v ? zoomAt(v, 1.2, size.w / 2, size.h / 2) : v)),
      zoomOut: () => setView((v) => (v ? zoomAt(v, 1 / 1.2, size.w / 2, size.h / 2) : v)),
      fit,
    };
  }, [props.controlsRef, fit, size.w, size.h]);

  // ---- theme
  useEffect(() => {
    const onTheme = () => requestAnimationFrame(() => setPalette(readPalette()));
    window.addEventListener("soraplan:theme", onTheme);
    return () => window.removeEventListener("soraplan:theme", onTheme);
  }, []);

  // ---- reference image
  useEffect(() => {
    if (!props.overlayUrl) {
      setOverlayImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setOverlayImg(img);
    img.onerror = () => setOverlayImg(null);
    img.src = props.overlayUrl;
  }, [props.overlayUrl]);

  // ---- drawing
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || size.w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(size.w * dpr);
    const ph = Math.round(size.h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = propsRef.current;
    drawPlan(ctx, {
      view,
      width: size.w,
      height: size.h,
      plan: p.plan,
      objects: p.objects,
      selectedId: p.selectedId,
      hoverId,
      layers: p.layers,
      overlay: overlayImg ? { img: overlayImg, opacity: p.overlayOpacity } : null,
      palette,
      mode: p.mode,
      decorations: p.decorations,
      pulse: pulseRef.current,
      drag,
      addRect,
    });
  }, [view, size, hoverId, overlayImg, palette, drag, addRect]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [
    draw,
    props.objects,
    props.selectedId,
    props.layers,
    props.overlayOpacity,
    props.decorations,
    props.plan,
    props.mode,
  ]);

  // Pulse loop for missing boxes
  useEffect(() => {
    if (!props.animate || reducedMotion()) {
      pulseRef.current = props.animate ? 1 : 0;
      return;
    }
    let raf = 0;
    const loop = (t: number) => {
      pulseRef.current = 0.5 + 0.5 * Math.sin(t / 380);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [props.animate, draw]);

  // ---- input
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const startDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view || e.button === 2) return;
    const p = propsRef.current;
    const { sx, sy } = localPoint(e);
    const w = toWorld(view, sx, sy);
    const capture = () => canvasRef.current?.setPointerCapture(e.pointerId);
    lastObjectsRef.current = null;
    lastFootprintRef.current = null;

    if (e.button === 1) {
      startDrag({ mode: "pan", startX: sx, startY: sy, origPanX: view.panX, origPanY: view.panY });
      capture();
      return;
    }

    if (p.mode === "edit" && p.tool === "addBox") {
      startDrag({ mode: "addBox", ax: w.x, ay: w.y, bx: w.x, by: w.y });
      capture();
      return;
    }

    const sel = p.selectedId ? p.objects.find((o) => o.id === p.selectedId) || null : null;
    if (sel && p.mode === "edit") {
      const h = handleAt(sel, sx, sy, view);
      if (h === "rotate" && !isWall(sel)) {
        const cx = sel.x + sel.w / 2;
        const cy = sel.y + sel.h / 2;
        startDrag({ mode: "rotate", id: sel.id, cx, cy, origRot: sel.rotation || 0, startAngle: Math.atan2(w.y - cy, w.x - cx) });
        capture();
        return;
      }
      if ((h === "wall-p1" || h === "wall-p2") && isWall(sel)) {
        startDrag({ mode: h, id: sel.id });
        capture();
        return;
      }
      if (h && h.startsWith("resize-") && !isWall(sel)) {
        startDrag({ mode: "resize", handle: h as any, id: sel.id, orig: { ...sel }, startX: w.x, startY: w.y });
        capture();
        return;
      }
    }
    if (sel && p.mode === "mapping" && !isWall(sel)) {
      const dec = p.decorations?.[sel.id];
      if (dec?.kind === "matched" && dec.footprint) {
        const k = scaleOf(view);
        const c = toScreen(view, sel.x + sel.w / 2, sel.y + sel.h / 2);
        const h = rectHandleAt(c.x, c.y, dec.footprint.w * k, dec.footprint.d * k, dec.footprint.rotation, sx, sy, {
          rotate: false,
          edges: !p.footprintLock,
        });
        if (h && h !== "rotate") {
          const cx = sel.x + sel.w / 2;
          const cy = sel.y + sel.h / 2;
          startDrag({
            mode: "footprint",
            id: sel.id,
            handle: h,
            cx,
            cy,
            rotation: dec.footprint.rotation,
            origW: dec.footprint.w,
            origD: dec.footprint.d,
            startDist: Math.hypot(w.x - cx, w.y - cy),
          });
          capture();
          return;
        }
      }
    }

    const tol = 6 / scaleOf(view);
    const hit = hitTest(p.objects, w.x, w.y, p.layers, tol);
    const selectable = hit && (p.mode === "edit" || !isWall(hit)) ? hit : null;
    p.onSelect(selectable ? selectable.id : null);
    if (selectable && p.mode === "edit") {
      const ref = isWall(selectable) ? { x: selectable.x1, y: selectable.y1 } : { x: selectable.x, y: selectable.y };
      startDrag({ mode: "move", id: selectable.id, dx: w.x - ref.x, dy: w.y - ref.y, moved: false });
      capture();
    } else if (!selectable) {
      startDrag({ mode: "pan", startX: sx, startY: sy, origPanX: view.panX, origPanY: view.panY });
      capture();
    }
  };

  const updateCursor = (sx: number, sy: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const p = propsRef.current;
    if (p.mode === "edit" && p.tool === "addBox") {
      canvas.style.cursor = "crosshair";
      return;
    }
    const w = toWorld(view, sx, sy);
    const sel = p.selectedId ? p.objects.find((o) => o.id === p.selectedId) : null;
    if (sel && p.mode === "edit") {
      const h = handleAt(sel, sx, sy, view);
      if (h === "rotate") return void (canvas.style.cursor = "grab");
      if (h === "wall-p1" || h === "wall-p2") return void (canvas.style.cursor = "crosshair");
      if (h) return void (canvas.style.cursor = resizeCursor(h, isWall(sel) ? 0 : sel.rotation));
    }
    if (sel && p.mode === "mapping" && !isWall(sel)) {
      const dec = p.decorations?.[sel.id];
      if (dec?.kind === "matched" && dec.footprint) {
        const k = scaleOf(view);
        const c = toScreen(view, sel.x + sel.w / 2, sel.y + sel.h / 2);
        const h = rectHandleAt(c.x, c.y, dec.footprint.w * k, dec.footprint.d * k, dec.footprint.rotation, sx, sy, {
          rotate: false,
          edges: !p.footprintLock,
        });
        if (h && h !== "rotate") return void (canvas.style.cursor = resizeCursor(h, dec.footprint.rotation));
      }
    }
    const hit = hitTest(p.objects, w.x, w.y, p.layers, 6 / scaleOf(view));
    const hoverable = hit && (p.mode === "edit" || !isWall(hit)) ? hit : null;
    setHoverId(hoverable ? hoverable.id : null);
    canvas.style.cursor = hoverable ? (hoverable.id === p.selectedId && p.mode === "edit" ? "move" : "pointer") : "default";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const p = propsRef.current;
    const { sx, sy } = localPoint(e);
    const w = toWorld(view, sx, sy);
    p.onPointerWorld?.(w);
    const d = dragRef.current;
    if (!d) {
      updateCursor(sx, sy);
      return;
    }
    if (d.mode === "pan") {
      setView({ ...view, panX: d.origPanX + (sx - d.startX), panY: d.origPanY + (sy - d.startY) });
      return;
    }
    if (d.mode === "addBox") {
      const next = { ...d, bx: w.x, by: w.y };
      dragRef.current = next;
      setAddRect(boxFromDrag(d.ax, d.ay, w.x, w.y, { w: p.plan.width, h: p.plan.height }));
      return;
    }
    if (d.mode === "footprint") {
      const r = scaleFootprint(d, w.x, w.y, Boolean(p.footprintLock));
      lastFootprintRef.current = r;
      p.onFootprintChange?.(d.id, r.w, r.d, r.factor, false);
      return;
    }
    const base = lastObjectsRef.current || p.objects;
    const obj = base.find((o) => o.id === d.id);
    if (!obj) return;
    let next: EditorObject = obj;
    if (d.mode === "move") {
      if (isWall(obj)) {
        const nx = w.x - d.dx;
        const ny = w.y - d.dy;
        next = moveWall(obj, nx - obj.x1, ny - obj.y1);
      } else {
        next = moveBox(obj, w.x, w.y, d, { w: p.plan.width, h: p.plan.height });
      }
      dragRef.current = { ...d, moved: true };
    } else if (d.mode === "resize" && !isWall(obj)) {
      next = resizeBox(d.orig, d.handle, w.x - d.startX, w.y - d.startY);
    } else if (d.mode === "rotate" && !isWall(obj)) {
      next = rotateBox(obj as BoxObj, d, w.x, w.y, { shift: e.shiftKey, alt: e.altKey });
    } else if ((d.mode === "wall-p1" || d.mode === "wall-p2") && isWall(obj)) {
      next = dragWallEnd(obj, d.mode, w.x, w.y);
    }
    const objects = replaceObject(base, next);
    lastObjectsRef.current = objects;
    p.onObjectsChange?.(objects, false);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const p = propsRef.current;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (d?.mode === "addBox") {
      const rect = boxFromDrag(d.ax, d.ay, d.bx, d.by, { w: p.plan.width, h: p.plan.height });
      setAddRect(null);
      if (rect && view && p.onAddRect) {
        const anchor = toScreen(view, rect.x + rect.w / 2, rect.y + rect.h);
        p.onAddRect(rect, anchor);
      }
    } else if (d?.mode === "footprint" && lastFootprintRef.current) {
      const r = lastFootprintRef.current;
      p.onFootprintChange?.(d.id, r.w, r.d, r.factor, true);
    } else if (d && d.mode !== "pan" && lastObjectsRef.current) {
      p.onObjectsChange?.(lastObjectsRef.current, true);
    }
    lastObjectsRef.current = null;
    lastFootprintRef.current = null;
    startDrag(null);
  };

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const r = canvasRef.current!.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => (v ? zoomAt(v, factor, e.clientX - r.left, e.clientY - r.top) : v));
    },
    [],
  );
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const project = useCallback((wx: number, wy: number) => (view ? toScreen(view, wx, wy) : { x: -9999, y: -9999 }), [view]);

  return (
    <div className="plan-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="plan-canvas__el"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setHoverId(null);
            propsRef.current.onPointerWorld?.(null);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {view && props.renderOverlay && <div className="plan-canvas__overlay">{props.renderOverlay(project, scaleOf(view))}</div>}
    </div>
  );
}
