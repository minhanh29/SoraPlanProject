// Searchable, category-filtered grid of ready assets: the scene style's system assets, then the user's own.
// Shared by the 3D view's "Add furniture" dialog and the mapping step's "Choose a model" dialog.
import { useEffect, useMemo, useState } from "react";
import { Icon, Spinner } from "../components/ui";
import type { Asset, StyleId } from "../lib/types";
import "./Scene3D/scene3d.css";

interface Props {
  assets: Record<string, Asset>;
  style: StyleId | null | undefined;
  /** Category filter selected when the picker opens (ignored when no asset has it). */
  initialCategory?: string | null;
  /** Asset being applied (shows a spinner on its card and disables the grid). */
  busyId?: string | null;
  onPick: (asset: Asset) => void;
}

export default function AssetPicker({ assets, style, initialCategory, busyId, onPick }: Props) {
  const options = useMemo(
    () =>
      Object.values(assets)
        .filter((a) => a.status === "ready" && (!a.isSystem || !style || a.style === style))
        .sort((a, b) => Number(!a.isSystem) - Number(!b.isSystem) || (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name)),
    [assets, style],
  );
  const categories = useMemo(() => [...new Set(options.map((a) => a.category).filter(Boolean) as string[])].sort(), [options]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  // Start on the box's category when there is something to show for it
  useEffect(() => {
    setCategory(initialCategory && categories.includes(initialCategory) ? initialCategory : null);
  }, [initialCategory, categories]);

  const q = search.trim().toLowerCase();
  const visible = options.filter(
    (a) => (!category || a.category === category) && (!q || `${a.name} ${a.category || ""}`.toLowerCase().includes(q)),
  );

  return (
    <>
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
        <p className="muted">No {style || ""} models match. Upload a photo to add your own.</p>
      ) : (
        <div className="s3d-picker s3d-add__grid">
          {visible.map((a) => (
            <button key={a.id} className="s3d-picker__card" disabled={!!busyId} onClick={() => onPick(a)}>
              <span className="s3d-picker__img">{a.thumbUrl || a.imageUrl ? <img src={(a.thumbUrl || a.imageUrl)!} alt="" loading="lazy" /> : null}</span>
              <span className="s3d-picker__name">
                {busyId === a.id && <Spinner size={11} />} {a.name}
              </span>
              <span className="subtle">{a.isSystem ? a.category : "Your asset"}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
