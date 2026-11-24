import { useState } from "react";
import type { ItemInstance, PlanUnits, SceneOp, SceneRoom } from "../../lib/types";
import { Icon } from "../../components/ui";
import { formatDims } from "../../lib/units";
import { furnitureDraft, furnitureTransform, type FurnitureDraft } from "./furnitureTransform";
import { pointInPolygon } from "./geometry";

interface Props {
  items: ItemInstance[];
  rooms: SceneRoom[];
  selectedId: string | null;
  units: PlanUnits;
  onSelect: (id: string) => void;
  onApply: (ops: SceneOp[], label?: string) => void;
  onClose: () => void;
}

function TransformForm({ item, units, onApply }: Pick<Props, "units" | "onApply"> & { item: ItemInstance }) {
  const [draft, setDraft] = useState(() => furnitureDraft(item, units));
  const [error, setError] = useState<string | null>(null);
  const initial = furnitureDraft(item, units);
  const changed = Object.keys(initial).some((k) => initial[k as keyof FurnitureDraft] !== draft[k as keyof FurnitureDraft]);
  const unit = units === "ft" ? "ft" : "m";
  const field = (key: keyof FurnitureDraft, label: string, suffix = unit) => <label>
    <span>{label} ({suffix})</span>
    <input type="number" step="any" value={draft[key]} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setError(null); }} />
  </label>;
  return <form className="s3d-furniture__form" noValidate onSubmit={(e) => {
    e.preventDefault();
    try {
      const ops = furnitureTransform(item, draft, units);
      if (ops.length) onApply(ops, `Edit ${item.label || "furniture"}`);
      setError(null);
    } catch (err) { setError((err as Error).message); }
  }}>
    <strong>{item.label || "Furniture"}</strong>
    <fieldset><legend>Size</legend><div className="s3d-furniture__fields">
      {field("w", "Width")}{field("d", "Depth")}{field("h", "Height")}
    </div></fieldset>
    <fieldset><legend>Position</legend><div className="s3d-furniture__fields">
      {field("x", "X")}{field("z", "Z")}{field("y", "Elevation")}
    </div></fieldset>
    {field("angle", "Rotation", "°")}
    {error && <p className="s3d-furniture__error" role="alert">{error}</p>}
    <div className="s3d-furniture__actions">
      <button type="button" className="btn btn--sm" disabled={!changed} onClick={() => { setDraft(initial); setError(null); }}>Reset</button>
      <button type="submit" className="btn btn--sm btn--primary" disabled={!changed}>Apply changes</button>
    </div>
    <p className="subtle">Changes save to your scene. Use Undo to restore the previous layout.</p>
  </form>;
}

export default function FurniturePanel(p: Props) {
  const [query, setQuery] = useState("");
  const selected = p.items.find((it) => it.id === p.selectedId);
  const roomName = (it: ItemInstance) => p.rooms.find((r) => pointInPolygon(it.position[0], it.position[2], r.polygon))?.name;
  const visible = p.items.filter((it) => `${it.label} ${it.category || ""} ${roomName(it) || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <aside className="s3d-furniture" aria-label="Furniture editor">
    <div className="s3d-furniture__head"><strong>Furniture · {p.items.length}</strong>
      <button className="icon-btn" onClick={p.onClose} aria-label="Close furniture editor"><Icon name="close" size={16} /></button>
    </div>
    <input className="s3d-furniture__search" type="search" aria-label="Find furniture" placeholder="Find furniture or room…" value={query} onChange={(e) => setQuery(e.target.value)} />
    <div className="s3d-furniture__list" role="group" aria-label="Furniture in your home">
      {visible.map((it) => <button key={it.id} className={it.id === p.selectedId ? "is-active" : ""} aria-pressed={it.id === p.selectedId} onClick={() => p.onSelect(it.id)}>
        <span>{it.label || "Furniture"}{roomName(it) && <small> · {roomName(it)}</small>}</span>
        <small>{formatDims(it.dims, p.units)}</small>
      </button>)}
      {!visible.length && <p className="subtle">{p.items.length ? "No matching furniture." : "No furniture yet. Use Add to place an item."}</p>}
    </div>
    {selected ? <TransformForm key={JSON.stringify([selected.id, selected.position, selected.dims, selected.rotationY, p.units])} item={selected} units={p.units} onApply={p.onApply} /> : <p className="subtle">Choose any item to resize, rotate, or relocate it.</p>}
  </aside>;
}
