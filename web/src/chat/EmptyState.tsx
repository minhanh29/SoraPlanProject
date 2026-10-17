import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, uploadToSignedUrl } from "../lib/api";
import { Icon, Spinner, ZoomableImage } from "../components/ui";

const ACCEPT = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_BYTES = 25 * 1024 * 1024;

function contentTypeOf(file: File): string {
  if (file.type) return file.type === "image/jpg" ? "image/jpeg" : file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

/** Default project name from a file name (same rule as backend workflow.title_from_filename). */
export function titleFromFilename(name: string): string {
  const stem = (name.split(/[\\/]/).pop() || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem ? (stem[0].toUpperCase() + stem.slice(1)).slice(0, 80) : "New project";
}

export const MAX_TITLE = 120;

export function validatePlanFile(file: File): string | null {
  if (!ACCEPT.includes(contentTypeOf(file))) return "Use a PNG, JPEG, WebP or PDF file.";
  if (file.size > MAX_BYTES) return "The file is larger than 25 MB.";
  if (!file.size) return "The file is empty.";
  return null;
}

export default function EmptyState() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<null | "creating" | "uploading" | "processing">(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const err = validatePlanFile(f);
    setError(err);
    if (err) return;
    setFile(f);
    setName(titleFromFilename(f.name));
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
    });
  };

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Whole-viewport drop target + paste
  useEffect(() => {
    let depth = 0;
    const enter = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: globalThis.DragEvent) => e.preventDefault();
    const drop = (e: globalThis.DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (!step) pick(e.dataTransfer?.files?.[0]);
    };
    const paste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0];
      if (f && !step) pick(f);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [step]);

  const create = async () => {
    if (!file) return;
    setError(null);
    try {
      setStep("creating");
      const ctype = contentTypeOf(file);
      const res = await api.createConversation({ fileName: file.name, contentType: ctype, sizeBytes: file.size });
      // The API names new projects after the file; apply the name typed here (renames project + conversation).
      const title = name.trim();
      if (title && title !== titleFromFilename(file.name)) await api.updateConversation(res.conversationId, { title });
      setStep("uploading");
      await uploadToSignedUrl(res.signedUploadUrl, file, res.contentType, setProgress);
      setStep("processing");
      await api.uploadComplete(res.conversationId);
      navigate(`/p/${res.conversationId}`);
    } catch (e) {
      setStep(null);
      setError(e instanceof ApiError ? e.message : (e as Error).message || "Upload failed");
    }
  };

  const onZoneDrop = (e: DragEvent) => {
    e.preventDefault();
  };

  return (
    <div className={`empty ${dragging ? "is-dragging" : ""}`}>
      <div className="empty__inner">
        <h1 className="empty__title">Drop your floor plan to start a new project</h1>
        <p className="empty__sub">Photo, scan or PDF of a floor plan. We'll turn it into a 3D home.</p>

        {!file ? (
          <button className="dropzone" onClick={() => input.current?.click()} onDrop={onZoneDrop}>
            <span className="dropzone__icon"><Icon name="upload" size={26} /></span>
            <span><strong>Drop a file</strong> or click to browse</span>
            <span className="subtle">PNG, JPEG, WebP or PDF · up to 25 MB</span>
          </button>
        ) : (
          <div className="pick card">
            <div className="pick__preview">
              {preview ? <ZoomableImage src={preview} alt="Selected floor plan" /> : <span className="pick__pdf">PDF</span>}
            </div>
            <div className="pick__meta">
              <label className="pick__name">
                <span>Project name</span>
                <input
                  className="input"
                  value={name}
                  maxLength={MAX_TITLE}
                  placeholder="e.g. Riverside apartment"
                  disabled={!!step}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !step && create()}
                />
              </label>
              <span className="subtle pick__file" title={file.name}>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              {step === "uploading" && <div className="progress"><span style={{ width: `${progress}%` }} /></div>}
              {step && <span className="subtle">{step === "creating" ? "Creating project…" : step === "uploading" ? `Uploading ${progress}%` : "Preparing the image…"}</span>}
            </div>
            <div className="pick__actions">
              <button className="btn btn--ghost" disabled={!!step} onClick={() => { setFile(null); setPreview(null); setName(""); }}>Change file</button>
              <button className="btn btn--primary" disabled={!!step} onClick={create}>
                {step ? <Spinner /> : <Icon name="plus" size={16} />} Create project
              </button>
            </div>
          </div>
        )}
        {error && <p className="empty__error" role="alert">{error}</p>}
        <input ref={input} type="file" hidden accept={ACCEPT.join(",")} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {dragging && <div className="drop-overlay"><Icon name="upload" size={32} /> Drop to start</div>}
    </div>
  );
}
