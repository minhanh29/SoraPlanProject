import type { Asset } from "../lib/types";
import { Dialog } from "../components/ui";
import ModelPreview from "../three/ModelPreview";
import { assetModelUrls } from "../hooks/useAssets";
import { formatLength } from "../lib/units";
import { statusLabel } from "./assetHelpers";
import "./assets.css";

export default function ModelViewerDialog({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const status = asset ? statusLabel(asset) : null;
  return (
    <Dialog open={!!asset} onClose={onClose} title={asset?.name} width={640}>
      {asset && (
        <div className="viewer">
          {asset.status === "ready" ? (
            <ModelPreview urls={assetModelUrls(asset)} height={360} />
          ) : (
            <div className="viewer__pending">
              {asset.imageUrl && <img src={asset.imageUrl} alt="" />}
              <p className="muted">
                {asset.status === "failed"
                  ? "3D generation failed for this photo. Try uploading a clearer photo of the object."
                  : status?.text
                    ? `${status.text} — the 3D model appears here when it's ready.`
                    : "The 3D model appears here when it's ready."}
              </p>
            </div>
          )}
          <dl className="viewer__facts">
            <div>
              <dt>Category</dt>
              <dd>{asset.category || "—"}</dd>
            </div>
            <div>
              <dt>Style</dt>
              <dd>{asset.style || "—"}</dd>
            </div>
            <div>
              <dt>Size (W × D × H)</dt>
              <dd>
                {asset.dims
                  ? `${formatLength(asset.dims.w)} × ${formatLength(asset.dims.d)} × ${formatLength(asset.dims.h)}`
                  : "Not measured"}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{asset.isSystem ? "System catalog" : "Your upload"}</dd>
            </div>
          </dl>
        </div>
      )}
    </Dialog>
  );
}
