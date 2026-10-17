// Scale inspector for a matched object in the mapping step (§2.4): 3D preview, W/D/H, ratio lock,
// 50–200 % slider relative to the automatic fit, Fit to box, Apply to all, Stretched warning.
import { useEffect, useState } from "react";
import type { Asset, Dims, MappingEntry, PlanUnits } from "../lib/types";
import { formatLength } from "../lib/units";
import { assetModelUrls } from "../hooks/useAssets";
import ModelPreview from "../three/ModelPreview";
import { Icon } from "../components/ui";
import { clampDims, isStretched, parseLength, scaleDims, setAxis } from "./PlanEditor/mapping";

interface Props {
  label: string;
  entry: MappingEntry;
  asset: Asset | undefined;
  dims: Dims;
  units: PlanUnits;
  lock: boolean;
  onLock: (v: boolean) => void;
  applyToAll: boolean;
  onApplyToAll: (v: boolean) => void;
  sameAssetCount: number;
  onDims: (d: Dims) => void;
  onFit: () => void;
  onClose: () => void;
  disabled?: boolean;
}

function DimInput({ label, value, units, onValue, disabled }: { label: string; value: number; units: PlanUnits; onValue: (m: number) => void; disabled?: boolean }) {
  const show = (v: number) => (units === "ft" ? formatLength(v, "ft") : String(Math.round(v * 100)));
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(show(value));
  }, [value, focused, units]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    const m = parseLength(text, units === "ft" ? "ft" : "m");
    if (m) onValue(m);
    else setText(show(value));
  };
  return (
    <label>
      {label} {units === "ft" ? "" : "(cm)"}
      <input
        className="input"
        value={text}
        disabled={disabled}
        inputMode={units === "ft" ? "text" : "decimal"}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          apply();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export default function MappingInspector(props: Props) {
  const { entry, asset, dims, units, lock } = props;
  const auto = entry.autoDims || entry.dims || dims;
  const pct = auto.w > 0 ? Math.round((dims.w / auto.w) * 100) : 100;
  const stretched = isStretched(dims, entry.autoDims || asset?.dims || null);
  const display: PlanUnits = units === "ft" ? "ft" : "m";
  const setAx = (axis: keyof Dims) => (v: number) => props.onDims(clampDims(setAxis(dims, axis, v, lock)));

  return (
    <aside className="map-inspector card" onPointerDown={(e) => e.stopPropagation()}>
      <div className="map-inspector__head">
        <strong title={asset?.name || props.label}>{asset?.name || props.label}</strong>
        {entry.dimsSource === "user" && <span className="pill pill--accent">Custom size</span>}
        <button className="icon-btn" onClick={props.onClose} aria-label="Close inspector">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="subtle" style={{ marginTop: -6 }}>
        {props.label}
        {entry.category ? ` · ${entry.category}` : ""}
      </div>

      <ModelPreview urls={assetModelUrls(asset)} dims={dims} height={170} />

      <div className="map-dims">
        <DimInput label="W" value={dims.w} units={display} onValue={setAx("w")} disabled={props.disabled} />
        <DimInput label="D" value={dims.d} units={display} onValue={setAx("d")} disabled={props.disabled} />
        <DimInput label="H" value={dims.h} units={display} onValue={setAx("h")} disabled={props.disabled} />
        <button
          className={`icon-btn ${lock ? "is-active" : ""}`}
          title={lock ? "Proportions locked" : "Proportions unlocked"}
          aria-label="Ratio lock"
          aria-pressed={lock}
          onClick={() => props.onLock(!lock)}
        >
          <Icon name={lock ? "lock" : "unlock"} size={16} />
        </button>
      </div>

      <div className="map-slider">
        <div>
          <span>Scale</span>
          <span className="mono">{pct}%</span>
        </div>
        <input
          type="range"
          min={50}
          max={200}
          value={Math.max(50, Math.min(200, pct))}
          disabled={props.disabled}
          onChange={(e) => props.onDims(clampDims(scaleDims(auto, Number(e.target.value) / 100)))}
        />
      </div>

      {stretched && <div className="map-warn">Stretched — this differs more than 20 % from the auto fit's proportions.</div>}

      {props.sameAssetCount > 1 && (
        <label className="check" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={props.applyToAll} onChange={(e) => props.onApplyToAll(e.target.checked)} />
          Apply to all {entry.category || props.label} boxes ({props.sameAssetCount})
        </label>
      )}

      <div className="map-actions">
        <button className="btn btn--sm" onClick={props.onFit} disabled={props.disabled}>
          <Icon name="fit" size={15} /> Fit to box
        </button>
        <span className="subtle" style={{ alignSelf: "center" }}>
          {formatLength(dims.w, display)} × {formatLength(dims.d, display)}
        </span>
      </div>
    </aside>
  );
}
