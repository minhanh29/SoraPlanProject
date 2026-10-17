import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { STYLES, type Asset } from "../lib/types";
import { useMyAssets, useSystemAssets } from "../hooks/useAssets";
import { useAuth } from "../hooks/useAuth";
import { ConfirmDialog, Icon, toast } from "../components/ui";
import AssetGrid from "./AssetGrid";
import ModelViewerDialog from "./ModelViewerDialog";
import EditAssetDialog from "./EditAssetDialog";
import UploadAssetDialog from "./UploadAssetDialog";
import { filterAssets, sortAssets, type StyleFilter } from "./assetHelpers";
import "./assets.css";

export default function AssetsPage({ tab }: { tab: "system" | "mine" }) {
  const { isAdmin, user } = useAuth();
  const system = useSystemAssets();
  const mine = useMyAssets();
  const [search, setSearch] = useState("");
  const [style, setStyle] = useState<StyleFilter>("all");
  const [viewing, setViewing] = useState<Asset | null>(null);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const source = tab === "system" ? system : mine;
  const visible = useMemo(
    () => (source ? sortAssets(filterAssets(source, search, tab === "system" ? style : "all")) : undefined),
    [source, search, style, tab],
  );
  // Keep the viewer in sync with live status updates
  const liveViewing = viewing ? source?.find((a) => a.id === viewing.id) || viewing : null;

  const canManage = (a: Asset) => (tab === "system" ? isAdmin : isAdmin || a.ownerUid === user?.uid);
  const filtered = !!search.trim() || (tab === "system" && style !== "all");

  return (
    <div className="assets-scroll">
      <div className="assets-page">
        <header className="assets-page__head">
          <div>
            <h1>Assets</h1>
            <p className="subtle">
              {tab === "system" ? "Curated 3D furniture used to furnish your homes." : "Furniture you turned into 3D from your own photos."}
            </p>
          </div>
          {tab === "mine" && (
            <button className="btn btn--primary" onClick={() => setUploadOpen(true)}>
              <Icon name="upload" size={16} /> Upload
            </button>
          )}
        </header>

        <nav className="assets-tabs" aria-label="Asset libraries">
          <NavLink to="/assets/system" className={({ isActive }) => `assets-tab ${isActive ? "is-active" : ""}`}>
            System
          </NavLink>
          <NavLink to="/assets/mine" className={({ isActive }) => `assets-tab ${isActive ? "is-active" : ""}`}>
            Your assets
          </NavLink>
        </nav>

        <div className="assets-toolbar">
          <label className="assets-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder={tab === "system" ? "Search sofas, beds, tables…" : "Search your assets"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search assets"
            />
          </label>
          {tab === "system" && (
            <div className="assets-styles" role="group" aria-label="Style filter">
              {(["all", ...STYLES] as StyleFilter[]).map((s) => (
                <button key={s} className={`chip ${style === s ? "is-active" : ""}`} aria-pressed={style === s} onClick={() => setStyle(s)}>
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>
          )}
        </div>

        <AssetGrid
          assets={visible}
          loading={source === undefined}
          canManage={canManage}
          onOpen={setViewing}
          onEdit={setEditing}
          onDelete={setDeleting}
          empty={
            filtered ? (
              <>
                <strong>No matches</strong>
                <span className="subtle">Try another search or style.</span>
              </>
            ) : tab === "system" ? (
              <>
                <strong>The catalog is empty</strong>
                <span className="subtle">System assets appear here once the catalog is seeded.</span>
              </>
            ) : (
              <>
                <Icon name="cube" size={30} />
                <strong>No assets yet</strong>
                <span className="subtle">Upload a photo of a piece you love and we'll turn it into a 3D model.</span>
                <button className="btn btn--primary" onClick={() => setUploadOpen(true)}>
                  <Icon name="upload" size={16} /> Upload a photo
                </button>
              </>
            )
          }
        />

        <ModelViewerDialog asset={liveViewing} onClose={() => setViewing(null)} />
        <EditAssetDialog asset={editing} onClose={() => setEditing(null)} />
        <UploadAssetDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
        <ConfirmDialog
          open={!!deleting}
          title="Delete asset?"
          message={
            <>
              “{deleting?.name}” will be removed from your library. Rooms that already use it keep a placeholder box.
            </>
          }
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            if (!deleting) return;
            try {
              await api.deleteAsset(deleting.id);
              toast("Asset deleted");
            } catch (e) {
              toast(e instanceof ApiError ? e.message : "Could not delete the asset", "error");
            }
          }}
        />
      </div>
    </div>
  );
}
