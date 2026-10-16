// Toolbar pieces shared by the plan review and mapping panels.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/ui";
import type { LayerVisibility } from "./hitTest";
import type { PlanCanvasControls } from "./PlanEditor";

export function ZoomControls({ controls }: { controls: React.MutableRefObject<PlanCanvasControls | null> }) {
  return (
    <>
      <button className="icon-btn" title="Zoom out" aria-label="Zoom out" onClick={() => controls.current?.zoomOut()}>
        <Icon name="zoomOut" />
      </button>
      <button className="icon-btn" title="Zoom in" aria-label="Zoom in" onClick={() => controls.current?.zoomIn()}>
        <Icon name="zoomIn" />
      </button>
      <button className="icon-btn" title="Fit to screen" aria-label="Fit to screen" onClick={() => controls.current?.fit()}>
        <Icon name="fit" />
      </button>
    </>
  );
}

const LAYER_LABELS: [keyof LayerVisibility, string][] = [
  ["wall", "Walls"],
  ["furniture", "Furniture"],
  ["fixture", "Fixtures"],
  ["room", "Rooms"],
  ["labels", "Labels"],
  ["grid", "Grid"],
  ["overlay", "Reference image"],
];

export function LayersMenu({
  layers,
  onLayers,
  opacity,
  onOpacity,
}: {
  layers: LayerVisibility;
  onLayers: (l: LayerVisibility) => void;
  opacity: number;
  onOpacity: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="layers" ref={ref}>
      <button className={`icon-btn ${open ? "is-active" : ""}`} title="Layers" aria-label="Layers" onClick={() => setOpen((o) => !o)}>
        <Icon name="grid" />
      </button>
      {open && (
        <div className="layers__pop">
          {LAYER_LABELS.map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" checked={layers[key]} onChange={(e) => onLayers({ ...layers, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <div className="subtle" style={{ marginTop: 4 }}>
            Reference opacity · {Math.round(opacity * 100)}%
          </div>
          <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={(e) => onOpacity(Number(e.target.value) / 100)} />
        </div>
      )}
    </div>
  );
}

/** True when keyboard shortcuts should be ignored (typing in a field). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}
