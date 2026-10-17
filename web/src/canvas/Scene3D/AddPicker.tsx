import { useEffect, useMemo, useState } from "react";
import { Dialog, Icon } from "../../components/ui";
import type { Asset, StyleId } from "../../lib/types";

interface Props {
  open: boolean;
  assets: Record<string, Asset>;
  style: StyleId;
  onPick: (asset: Asset) => void;
  onClose: () => void;
}

/** Furniture to add to the scene: ready system assets of the scene's style, then the user's own. */
export default function AddPicker({ open, assets, style, onPick, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setSearch("");
      setCategory(null);
    }
  }, [open]);

  const options = useMemo(
    () =>
      Object.values(assets)
        .filter((a) => a.status === "ready" && (!a.isSystem || a.style === style))
        .sort((a, b) => Number(!a.isSystem) - Number(!b.isSystem) || (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name)),
    [assets, style],
  );
  const categories = useMemo(() => [...new Set(options.map((a) => a.category).filter(Boolean) as string[])].sort(), [options]);
  const q = search.trim().toLowerCase();
  const visible = options.filter(
    (a) => (!category || a.category === category) && (!q || `${a.name} ${a.category || ""}`.toLowerCase().includes(q)),
  );

  return (
    <Dialog open={open} onClose={onClose} title="Add furniture" width={640}>
      <div className="s3d-add__bar">
        <label className="s3d-add__search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search sofas, beds, lamps…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search furniture" autoFocus />
        </label>
        <div className="s3d-add__cats" role="group" aria-label="Category">
          <button className={`chip ${category === null ? "is-active" : ""}`} aria-pressed={category === null} onClick={() => setCategory(null)}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} className={`chip ${category === c ? "is-active" : ""}`} aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="muted">No {style} models match. Upload a photo on the Assets page to add your own.</p>
      ) : (
        <div className="s3d-picker s3d-add__grid">
          {visible.map((a) => (
            <button key={a.id} className="s3d-picker__card" onClick={() => onPick(a)}>
              <span className="s3d-picker__img">{a.imageUrl ? <img src={a.imageUrl} alt="" loading="lazy" /> : null}</span>
              <span className="s3d-picker__name">{a.name}</span>
              <span className="subtle">{a.isSystem ? a.category : "Your asset"}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
