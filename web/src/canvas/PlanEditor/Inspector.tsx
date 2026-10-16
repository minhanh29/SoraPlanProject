// Inspector for the selected object in the plan review editor (plan units).
import { useEffect, useState } from "react";
import { CATALOG_CATEGORIES, type PlanUnits } from "../../lib/types";
import { Icon } from "../../components/ui";
import { isWall, unitSymbol, type EditorObject } from "./model";

interface Props {
  obj: EditorObject;
  units: PlanUnits;
  onChange: (next: EditorObject, commit: boolean) => void;
  onDelete: () => void;
  onRotate90: () => void;
  onClose: () => void;
}

/** Number input that only reports parsed values and tolerates partial typing. */
function NumField({
  label,
  value,
  suffix,
  step = 0.1,
  onValue,
  onCommit,
}: {
  label: string;
  value: number;
  suffix?: string;
  step?: number;
  onValue: (v: number) => void;
  onCommit: () => void;
}) {
  const [text, setText] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(step >= 1 ? String(Math.round(value)) : value.toFixed(2));
  }, [value, focused, step]);
  return (
    <label className="pe-num">
      <span>{label}</span>
      <input
        className="input"
        inputMode="decimal"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onCommit();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onValue(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

export default function Inspector({ obj, units, onChange, onDelete, onRotate90, onClose }: Props) {
  const sym = unitSymbol(units).trim();
  const set = (patch: Partial<EditorObject>) => onChange({ ...obj, ...patch } as EditorObject, false);
  const commit = () => onChange(obj, true);
  const [name, setName] = useState(obj.name);
  useEffect(() => setName(obj.name), [obj.id, obj.name]);

  return (
    <aside className="pe-inspector card">
      <div className="pe-inspector__head">
        <span className="pill pill--accent">{isWall(obj) ? (obj.exterior ? "Exterior wall" : "Wall") : obj.type === "fixture" ? "Fixture" : "Furniture"}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close inspector">
          <Icon name="close" size={16} />
        </button>
      </div>

      {!isWall(obj) && (
        <>
          <div className="field">
            <label>Label</label>
            <input
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                set({ name: e.target.value });
              }}
              onBlur={commit}
            />
          </div>
          <div className="field">
            <label>Category</label>
            <select
              className="select"
              value={obj.category || ""}
              onChange={(e) => onChange({ ...obj, category: e.target.value || null }, true)}
            >
              <option value="">Auto ({obj.subtype.replace(/_/g, " ")})</option>
              {CATALOG_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="pe-grid">
            <NumField label="X" value={obj.x} suffix={sym} onValue={(v) => set({ x: v })} onCommit={commit} />
            <NumField label="Y" value={obj.y} suffix={sym} onValue={(v) => set({ y: v })} onCommit={commit} />
            <NumField label="W" value={obj.w} suffix={sym} onValue={(v) => v > 0 && set({ w: v })} onCommit={commit} />
            <NumField label="H" value={obj.h} suffix={sym} onValue={(v) => v > 0 && set({ h: v })} onCommit={commit} />
            <NumField
              label="Rot"
              value={obj.rotation || 0}
              suffix="°"
              step={1}
              onValue={(v) => set({ rotation: ((v % 360) + 360) % 360 })}
              onCommit={commit}
            />
          </div>
        </>
      )}

      {isWall(obj) && (
        <div className="pe-grid">
          <NumField label="X1" value={obj.x1} suffix={sym} onValue={(v) => set({ x1: v })} onCommit={commit} />
          <NumField label="Y1" value={obj.y1} suffix={sym} onValue={(v) => set({ y1: v })} onCommit={commit} />
          <NumField label="X2" value={obj.x2} suffix={sym} onValue={(v) => set({ x2: v })} onCommit={commit} />
          <NumField label="Y2" value={obj.y2} suffix={sym} onValue={(v) => set({ y2: v })} onCommit={commit} />
          <NumField label="Thick" value={obj.thickness} suffix={sym} onValue={(v) => v > 0 && set({ thickness: v })} onCommit={commit} />
        </div>
      )}

      <div className="pe-inspector__actions">
        {!isWall(obj) && (
          <button className="btn btn--sm" onClick={onRotate90}>
            <Icon name="rotate" size={15} /> Rotate 90°
          </button>
        )}
        <button className="btn btn--sm pe-danger" onClick={onDelete}>
          <Icon name="trash" size={15} /> Delete
        </button>
      </div>
    </aside>
  );
}
