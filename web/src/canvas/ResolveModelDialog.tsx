// Mapping step: give a plan box a model (an unmatched one, or swap a matched one's), either picked from the
// asset library or made from a photo (the upload dialog takes over for that path).
import { useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import type { Asset, StyleId } from "../lib/types";
import { Dialog, Icon, toast } from "../components/ui";
import AssetPicker from "./AssetPicker";

export interface ResolveTarget {
  componentId: string;
  label: string;
  category: string | null;
  /** Name of the model the box has now (Change model); absent for an unmatched box. */
  currentName?: string;
}

interface Props {
  target: ResolveTarget | null;
  projectId: string;
  style: StyleId | null | undefined;
  assets: Record<string, Asset>;
  onUpload: (target: ResolveTarget) => void;
  onClose: () => void;
}

export default function ResolveModelDialog({ target, projectId, style, assets, onUpload, onClose }: Props) {
  const [step, setStep] = useState<"choose" | "library">("choose");
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    if (target) setStep("choose");
  }, [target]);

  const pick = async (asset: Asset) => {
    if (!target) return;
    setBusyId(asset.id);
    try {
      await api.updateMapping(projectId, { componentId: target.componentId, assetId: asset.id });
      toast(`${asset.name} placed in “${target.label}”`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not use this model", "error");
    } finally {
      setBusyId(null);
    }
  };

  const title =
    step === "library" ? (
      <span className="resolve__title">
        <button className="icon-btn" onClick={() => setStep("choose")} aria-label="Back" disabled={!!busyId}>
          <Icon name="back" />
        </button>
        Choose a model for “{target?.label}”
      </span>
    ) : target?.currentName ? (
      `Change the model for “${target.label}”`
    ) : (
      `Add a model for “${target?.label || "this item"}”`
    );

  return (
    <Dialog open={!!target} onClose={() => !busyId && onClose()} title={title} width={step === "library" ? 640 : 520}>
      {target && step === "choose" && (
        <div className="resolve__options">
          <button className="resolve__option" onClick={() => setStep("library")}>
            <span className="resolve__icon"><Icon name="grid" size={22} /></span>
            <span className="resolve__text">
              <strong>Choose from assets</strong>
              <span className="subtle">
                Pick a ready model from the {style ? `${style} collection` : "catalog"} or your own uploads.
                {target.category ? ` Starts on ${target.category}.` : ""}
              </span>
            </span>
          </button>
          <button
            className="resolve__option"
            onClick={() => {
              onUpload(target);
              onClose();
            }}
          >
            <span className="resolve__icon"><Icon name="upload" size={22} /></span>
            <span className="resolve__text">
              <strong>Upload a photo</strong>
              <span className="subtle">Turn a photo of your own piece into a 3D model (takes a few minutes).</span>
            </span>
          </button>
        </div>
      )}
      {target && step === "library" && (
        <AssetPicker assets={assets} style={style} initialCategory={target.category} busyId={busyId} onPick={pick} />
      )}
    </Dialog>
  );
}
