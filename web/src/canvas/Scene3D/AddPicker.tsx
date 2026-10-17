import { Dialog } from "../../components/ui";
import type { Asset, StyleId } from "../../lib/types";
import AssetPicker from "../AssetPicker";

interface Props {
  open: boolean;
  assets: Record<string, Asset>;
  style: StyleId;
  onPick: (asset: Asset) => void;
  onClose: () => void;
}

/** Furniture to add to the scene: ready system assets of the scene's style, then the user's own. */
export default function AddPicker({ open, assets, style, onPick, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Add furniture" width={640}>
      {/* Remounted on every open, so search and filter start fresh */}
      {open && <AssetPicker assets={assets} style={style} onPick={onPick} />}
    </Dialog>
  );
}
