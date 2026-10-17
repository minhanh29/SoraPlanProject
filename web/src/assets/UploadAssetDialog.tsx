import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, uploadToSignedUrl } from "../lib/api";
import { CATALOG_CATEGORIES, type Asset } from "../lib/types";
import { Dialog, Icon, Spinner, toast } from "../components/ui";
import { ACCEPTED_TYPES, nameFromFile, validatePhoto } from "./assetHelpers";
import "./assets.css";

export interface UploadAssetPreset {
  name?: string;
  category?: string | null;
  /** When both are set, the new asset fills that plan box (mapping step). */
  projectId?: string;
  componentId?: string;
}

type Step = "idle" | "uploading" | "confirming";

async function dataUriToBlob(dataUri: string): Promise<Blob> {
  const res = await fetch(dataUri);
  return res.blob();
}

export default function UploadAssetDialog({
  open,
  onClose,
  preset,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  preset?: UploadAssetPreset;
  onUploaded?: (asset: Asset) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cutout, setCutout] = useState<string | null>(null); // data URI of the transparent PNG
  const [showCutout, setShowCutout] = useState(true);
  const [removingBg, setRemovingBg] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = step !== "idle" || removingBg;

  // Reset whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setCutout(null);
    setShowCutout(true);
    setName(preset?.name || "");
    setCategory(preset?.category || "");
    setStep("idle");
    setProgress(0);
    setError(null);
  }, [open, preset?.name, preset?.category]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = useCallback(
    (f: File | null | undefined) => {
      if (!f || busy) return;
      const problem = validatePhoto(f);
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      setFile(f);
      setCutout(null);
      setName((n) => n || nameFromFile(f.name));
    },
    [busy],
  );

  // Paste an image while the dialog is open
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.files || []).find((f) => ACCEPTED_TYPES.includes(f.type));
      if (item) {
        e.preventDefault();
        pick(item);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, pick]);

  async function removeBackground() {
    if (!file) return;
    setRemovingBg(true);
    setError(null);
    try {
      const { dataUri } = await api.removeBackground(file, name.trim() || "furniture");
      setCutout(dataUri);
      setShowCutout(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove the background");
    } finally {
      setRemovingBg(false);
    }
  }

  async function submit() {
    if (!file || !name.trim() || !category || busy) return;
    setError(null);
    try {
      const useCutout = !!cutout && showCutout;
      const blob: Blob = useCutout ? await dataUriToBlob(cutout!) : file;
      const contentType = useCutout ? "image/png" : file.type;
      const fileName = useCutout ? `${file.name.replace(/\.[^.]+$/, "")}.png` : file.name;

      setStep("uploading");
      setProgress(0);
      const { assetId, signedUploadUrl, contentType: signedType } = await api.assetUploadUrl({
        fileName,
        contentType,
        sizeBytes: blob.size,
      });
      await uploadToSignedUrl(signedUploadUrl, blob, signedType || contentType, setProgress);

      setStep("confirming");
      const asset = await api.confirmAsset(assetId, {
        name: name.trim(),
        category,
        style: null,
        ...(preset?.projectId && preset?.componentId ? { projectId: preset.projectId, componentId: preset.componentId } : {}),
      });
      toast(`Generating a 3D model of “${asset.name}”…`, "success");
      onUploaded?.(asset);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Upload failed");
      setStep("idle");
    }
  }

  const shown = cutout && showCutout ? cutout : previewUrl;

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={preset?.componentId ? `Upload a photo for “${preset.name || "this item"}”` : "Upload your furniture"}
      width={560}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={!file || !name.trim() || !category || busy}>
            {step === "uploading" ? (
              <>
                <Spinner /> Uploading {progress}%
              </>
            ) : step === "confirming" ? (
              <>
                <Spinner /> Starting 3D generation…
              </>
            ) : (
              "Upload & generate 3D"
            )}
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {!file ? (
        <div
          className={`upload-drop ${dragOver ? "is-over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), inputRef.current?.click())}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="upload" size={26} />
          <strong>Drop a photo of the object</strong>
          <span className="subtle">or click to browse · paste works too · PNG, JPEG, WebP up to 25 MB</span>
        </div>
      ) : (
        <div className="upload-preview">
          <div className={`upload-preview__img ${cutout && showCutout ? "is-cutout" : ""}`}>
            {shown && <img src={shown} alt="Selected photo" />}
            {removingBg && (
              <div className="upload-preview__busy">
                <Spinner /> Removing background…
              </div>
            )}
          </div>
          <div className="upload-preview__actions">
            {cutout ? (
              <div className="segmented" role="group" aria-label="Compare">
                <button className={!showCutout ? "is-active" : ""} onClick={() => setShowCutout(false)} disabled={busy}>
                  Original
                </button>
                <button className={showCutout ? "is-active" : ""} onClick={() => setShowCutout(true)} disabled={busy}>
                  Background removed
                </button>
              </div>
            ) : (
              <button className="btn btn--sm" onClick={removeBackground} disabled={busy}>
                {removingBg ? <Spinner /> : <Icon name="image" size={16} />} Remove background
              </button>
            )}
            <button className="btn btn--sm btn--ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
              Change photo
            </button>
          </div>
        </div>
      )}

      <div className="upload-fields">
        <div className="field">
          <label htmlFor="upload-asset-name">Name</label>
          <input
            id="upload-asset-name"
            className="input"
            value={name}
            maxLength={120}
            placeholder="e.g. Green velvet sofa"
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field">
          <label htmlFor="upload-asset-category">Category</label>
          <select
            id="upload-asset-category"
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose…</option>
            {CATALOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {step === "uploading" && (
        <div className="upload-progress" aria-label="Upload progress">
          <div style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}
