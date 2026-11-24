import { useEffect, useRef, type MutableRefObject } from "react";
import type { SceneRoom } from "../../lib/types";
import { Icon } from "../../components/ui";
import type { WalkMotion } from "./FirstPersonCamera";

interface Props {
  rooms: SceneRoom[];
  furnitureOpen: boolean;
  motionRef: MutableRefObject<WalkMotion>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleFurniture: () => void;
  onRoom: (id: string) => void;
  onExit: () => void;
}

export default function WalkthroughBar(p: Props) {
  const held = useRef(new Map<number, string>());
  const updateMotion = () => {
    const directions = new Set(held.current.values());
    p.motionRef.current = {
      forward: Number(directions.has("Forward")) - Number(directions.has("Backward")),
      right: Number(directions.has("Right")) - Number(directions.has("Left")),
    };
  };
  useEffect(() => {
    const clear = () => { held.current.clear(); p.motionRef.current = { forward: 0, right: 0 }; };
    clear();
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clear();
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [p.motionRef]);

  return <>
    <div className="s3d-toolbar s3d-walkbar" role="toolbar" aria-label="First-person controls">
      <div className="s3d-toolbar__group">
        <span className="s3d-walkbar__title">First person</span>
        {p.rooms.length > 0 && <select aria-label="Go to room" defaultValue="" onChange={(e) => { p.onRoom(e.target.value); e.target.value = ""; }}>
          <option value="" disabled>Go to room…</option>
          {p.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>}
        <button className={`s3d-tool ${p.furnitureOpen ? "is-active" : ""}`} onClick={p.onToggleFurniture} aria-pressed={p.furnitureOpen} title="Enter exact furniture sizes and positions">
          <Icon name="box" />Furniture
        </button>
      </div>
      <div className="s3d-toolbar__group">
        <button className="icon-btn" aria-label="Undo" title="Undo" disabled={!p.canUndo} onClick={p.onUndo}><Icon name="undo" /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo" disabled={!p.canRedo} onClick={p.onRedo}><Icon name="redo" /></button>
        <button className="s3d-tool" onClick={p.onExit}>Exit walk</button>
      </div>
    </div>
    <div className="s3d-walk-hint" role="status">
      Click furniture to select · Drag furniture to move · Handles resize / rotate · Drag background or right-drag to look · WASD / arrows to walk · Esc to exit
    </div>
    <div className="s3d-walk-pad" role="group" aria-label="Walk movement">
      {([ ["Forward", "↑"], ["Left", "←"], ["Backward", "↓"], ["Right", "→"] ] as const).map(([direction, arrow]) => <button
        key={direction}
        className={`s3d-walk-pad__${direction.toLowerCase()}`}
        aria-label={`Walk ${direction.toLowerCase()}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          held.current.set(e.pointerId, direction);
          updateMotion();
        }}
        onPointerUp={(e) => { held.current.delete(e.pointerId); updateMotion(); }}
        onPointerCancel={(e) => { held.current.delete(e.pointerId); updateMotion(); }}
        onLostPointerCapture={(e) => { held.current.delete(e.pointerId); updateMotion(); }}
        onKeyDown={(e) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault(); held.current.set(-1, direction); updateMotion();
        }}
        onKeyUp={() => { held.current.delete(-1); updateMotion(); }}
        onBlur={() => { held.current.delete(-1); updateMotion(); }}
      >{arrow}</button>)}
    </div>
  </>;
}
