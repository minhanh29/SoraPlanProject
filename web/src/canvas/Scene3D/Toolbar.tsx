import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/ui";

const WALL_SWATCHES = ["#8C8984", "#EFE8DD", "#FFFFFF", "#D9D4CC", "#B9C4BE", "#4A4E54"];
const FLOOR_SWATCHES = ["#5A4636", "#C8A57A", "#9C7B5B", "#D8C3A5", "#7A7672", "#3E3A36"];

function ColorButton({ label, value, swatches, onPick }: { label: string; value: string; swatches: string[]; onPick: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  // Native pickers fire continuously while dragging; commit the last value.
  const commitLater = (hex: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onPick(hex), 350);
  };
  return (
    <div className="s3d-color" ref={ref}>
      <button className="s3d-tool" onClick={() => setOpen((o) => !o)} title={label} aria-label={label}>
        <span className="s3d-swatch" style={{ background: value }} />
        <span className="s3d-tool__label">{label}</span>
      </button>
      {open && (
        <div className="s3d-popover">
          <div className="s3d-swatches">
            {swatches.map((c) => (
              <button
                key={c}
                className={`s3d-swatch s3d-swatch--lg ${c.toLowerCase() === value.toLowerCase() ? "is-active" : ""}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <label className="s3d-custom">
            <input type="color" defaultValue={value} onChange={(e) => commitLater(e.target.value)} />
            Custom…
          </label>
        </div>
      )}
    </div>
  );
}

interface Props {
  wallColor: string;
  floorColor: string;
  cutaway: boolean;
  overlay: boolean;
  /** False when the project has no parsed plan (overlay unavailable). */
  canOverlay: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onReset: () => void;
  onTop: () => void;
  onToggleCutaway: () => void;
  onToggleOverlay: () => void;
  onAdd: () => void;
  onWallColor: (hex: string) => void;
  onFloorColor: (hex: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
}

export default function Toolbar(p: Props) {
  return (
    <div className="s3d-toolbar">
      <div className="s3d-toolbar__group">
        <button className="s3d-tool" onClick={p.onReset} title="Reset view">
          <Icon name="fit" />
          <span className="s3d-tool__label">Reset view</span>
        </button>
        <button className="s3d-tool" onClick={p.onTop} title="Top view">
          <Icon name="grid" />
          <span className="s3d-tool__label">Top</span>
        </button>
        <button className={`s3d-tool ${p.cutaway ? "is-active" : ""}`} onClick={p.onToggleCutaway} title="Cut walls at 1 m" aria-pressed={p.cutaway}>
          <Icon name="cube" />
          <span className="s3d-tool__label">{p.cutaway ? "Cutaway" : "Full walls"}</span>
        </button>
        {p.canOverlay && (
          <button
            className={`s3d-tool ${p.overlay ? "is-active" : ""}`}
            onClick={p.onToggleOverlay}
            title="Overlay the floor plan and parsed objects on the floor"
            aria-pressed={p.overlay}
          >
            <Icon name="layers" />
            <span className="s3d-tool__label">Plan overlay</span>
          </button>
        )}
        <ColorButton label="Walls" value={p.wallColor} swatches={WALL_SWATCHES} onPick={p.onWallColor} />
        <ColorButton label="Floor" value={p.floorColor} swatches={FLOOR_SWATCHES} onPick={p.onFloorColor} />
      </div>
      <div className="s3d-toolbar__group">
        <button className="s3d-tool s3d-tool--primary" onClick={p.onAdd} title="Add furniture" aria-label="Add furniture">
          <Icon name="plus" />
          <span className="s3d-tool__label">Add</span>
        </button>
        <button className="icon-btn" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Shift+Ctrl+Z)" aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button className="icon-btn" onClick={p.onClose} title="Close" aria-label="Close 3D view">
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
