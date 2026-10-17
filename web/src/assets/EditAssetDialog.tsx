import { useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import { CATALOG_CATEGORIES, STYLES, type Asset, type StyleId } from "../lib/types";
import { Dialog, Spinner, toast } from "../components/ui";
import { useAuth } from "../hooks/useAuth";

export default function EditAssetDialog({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [isSystem, setIsSystem] = useState(false);
  const [style, setStyle] = useState<StyleId | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    setName(asset.name);
    setCategory(asset.category || "");
    setIsSystem(asset.isSystem);
    setStyle(asset.style || "");
    setError(null);
  }, [asset]);

  const showCategory = isAdmin || !asset?.isSystem;
  // D8: a system asset needs style + category, otherwise it can never auto-map.
  const promoteInvalid = isAdmin && isSystem && (!style || !category);
  const canSave = !!name.trim() && !promoteInvalid && !busy;

  async function save() {
    if (!asset || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Parameters<typeof api.updateAsset>[1] = { name: name.trim() };
      if (showCategory && category) patch.category = category;
      if (isAdmin) {
        patch.isSystem = isSystem;
        patch.style = style || null;
      }
      await api.updateAsset(asset.id, patch);
      toast("Asset updated", "success");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save changes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!asset}
      onClose={onClose}
      title="Edit asset"
      width={460}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save} disabled={!canSave}>
            {busy ? <Spinner /> : "Save"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="field">
          <label htmlFor="edit-asset-name">Name</label>
          <input id="edit-asset-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {showCategory && (
          <div className="field">
            <label htmlFor="edit-asset-category">Category</label>
            <select id="edit-asset-category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose…</option>
              {CATALOG_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}
        {isAdmin && (
          <div className="admin-box">
            <label className="check">
              <input type="checkbox" checked={isSystem} onChange={(e) => setIsSystem(e.target.checked)} />
              System asset (visible to everyone, used for auto-mapping)
            </label>
            {isSystem && (
              <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
                <label htmlFor="edit-asset-style">Style</label>
                <select id="edit-asset-style" className="select" value={style} onChange={(e) => setStyle(e.target.value as StyleId | "")}>
                  <option value="">Choose…</option>
                  {STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {promoteInvalid && <span className="subtle">Style and category are required for system assets.</span>}
              </div>
            )}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </form>
    </Dialog>
  );
}
