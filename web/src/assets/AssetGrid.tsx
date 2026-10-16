import type { ReactNode } from "react";
import type { Asset } from "../lib/types";
import AssetCard from "./AssetCard";

export default function AssetGrid({
  assets,
  loading,
  empty,
  canManage,
  onOpen,
  onEdit,
  onDelete,
}: {
  assets: Asset[] | undefined;
  loading: boolean;
  empty: ReactNode;
  canManage: (a: Asset) => boolean;
  onOpen: (a: Asset) => void;
  onEdit: (a: Asset) => void;
  onDelete: (a: Asset) => void;
}) {
  if (loading) {
    return (
      <div className="asset-grid" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="asset-card asset-card--skeleton">
            <div className="asset-card__media shimmer" />
            <div className="asset-card__body">
              <div className="shimmer skel-line" />
              <div className="shimmer skel-line skel-line--short" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!assets?.length) return <div className="assets-empty">{empty}</div>;
  return (
    <div className="asset-grid">
      {assets.map((a) => (
        <AssetCard key={a.id} asset={a} canManage={canManage(a)} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
