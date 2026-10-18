import { useMemo } from "react";
import { Dialog } from "../../components/ui";
import type { Asset, ItemInstance, StyleId } from "../../lib/types";

interface Props {
  item: ItemInstance | null;
  assets: Record<string, Asset>;
  style: StyleId;
  onPick: (asset: Asset) => void;
  onClose: () => void;
}

/** Same-category alternatives: system assets of the scene's style, or the user's own. */
export default function ReplacePicker({ item, assets, style, onPick, onClose }: Props) {
  const options = useMemo(() => {
    if (!item) return [];
    return Object.values(assets)
      .filter(
        (a) =>
          a.id !== item.assetId &&
          a.status === "ready" &&
          (!item.category || a.category === item.category) &&
          (!a.isSystem || a.style === style),
      )
      .sort((a, b) => Number(a.isSystem) - Number(b.isSystem) || a.name.localeCompare(b.name));
  }, [item, assets, style]);

  return (
    <Dialog open={!!item} onClose={onClose} title={`Replace ${item?.label || "item"}`} width={560}>
      {options.length === 0 ? (
        <p className="muted">
          No other {item?.category ? <strong>{item.category}</strong> : "matching"} models yet. Upload a photo on the Assets page to add one.
        </p>
      ) : (
        <div className="s3d-picker">
          {options.map((a) => (
            <button key={a.id} className="s3d-picker__card" onClick={() => onPick(a)}>
              <span className="s3d-picker__img">{a.thumbUrl || a.imageUrl ? <img src={(a.thumbUrl || a.imageUrl)!} alt="" loading="lazy" /> : null}</span>
              <span className="s3d-picker__name">{a.name}</span>
              <span className="subtle">{a.isSystem ? a.style : "Your asset"}</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
