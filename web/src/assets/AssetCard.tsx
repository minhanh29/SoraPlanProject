import type { Asset } from "../lib/types";
import { shortDate } from "../lib/units";
import { Icon } from "../components/ui";
import AssetMenu from "./AssetMenu";
import { statusLabel } from "./assetHelpers";

export default function AssetCard({
  asset,
  canManage,
  onOpen,
  onEdit,
  onDelete,
}: {
  asset: Asset;
  canManage: boolean;
  onOpen: (a: Asset) => void;
  onEdit: (a: Asset) => void;
  onDelete: (a: Asset) => void;
}) {
  const status = statusLabel(asset);
  return (
    <article
      className="asset-card"
      tabIndex={0}
      role="button"
      aria-label={`Open ${asset.name}`}
      onClick={() => onOpen(asset)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(asset);
        }
      }}
    >
      <div className="asset-card__media">
        {asset.thumbUrl || asset.imageUrl ? (
          <img src={asset.thumbUrl || asset.imageUrl!} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="asset-card__placeholder">
            <Icon name="cube" size={28} />
          </span>
        )}
        {status && (
          <span className={`asset-card__status pill ${status.tone === "accent" ? "pill--accent" : status.tone === "danger" ? "pill--danger" : ""}`}>
            {status.tone === "accent" && <span className="spinner" style={{ width: 10, height: 10 }} />}
            {status.text}
          </span>
        )}
        {canManage && (
          <div className="asset-card__menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <AssetMenu onEdit={() => onEdit(asset)} onDelete={() => onDelete(asset)} />
          </div>
        )}
      </div>
      <div className="asset-card__body">
        <div className="asset-card__name" title={asset.name}>
          {asset.name}
        </div>
        <div className="asset-card__meta">
          <span className="asset-card__cat">{asset.category}</span>
          {asset.createdAt && <span>{shortDate(asset.createdAt)}</span>}
        </div>
      </div>
    </article>
  );
}
