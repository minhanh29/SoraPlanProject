// Stage "cropping": tight crop of the uploaded plan. The rect is saved to the conversation (debounced) so that
// "I'm done" in chat crops exactly what the user sees; "Confirm crop" runs the same action as the Gemini tool.
import { useEffect, useRef, useState } from "react";
import type { PanelProps } from "./panelTypes";
import type { CropRect } from "../lib/types";
import { api } from "../lib/api";
import { Icon, Spinner, toast } from "../components/ui";
import CropCanvas, { clampCrop } from "./CropCanvas";
import "./panels.css";

const SAVE_DELAY = 400;

export default function CropPanel({ conversation, project, files, onClose }: PanelProps) {
  const original = project.planImageOriginal;
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(
    original?.width && original?.height ? { width: original.width, height: original.height } : null,
  );
  const [crop, setCrop] = useState<CropRect | null>(() => conversation.stageData?.crop || project.crop || null);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<CropRect | null>(null);
  const touched = useRef(false);

  // Adopt a crop set elsewhere (e.g. restored after reload) until the user touches the canvas.
  useEffect(() => {
    if (touched.current) return;
    const c = conversation.stageData?.crop || project.crop;
    if (c) setCrop(c);
  }, [conversation.stageData?.crop, project.crop]);

  const flush = async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const c = pending.current;
    pending.current = null;
    if (c) {
      try {
        await api.updateConversation(conversation.id, { stageData: { crop: c } });
      } catch {
        /* the confirm call carries the crop anyway */
      }
    }
  };

  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (c: CropRect) => {
    touched.current = true;
    setCrop(c);
    pending.current = c;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
  };

  const full = imgSize ? { x: 0, y: 0, width: imgSize.width, height: imgSize.height } : null;
  const effective = crop && imgSize ? clampCrop(crop, imgSize.width, imgSize.height) : full;

  const confirm = async () => {
    if (!effective) return;
    setConfirming(true);
    try {
      pending.current = null;
      if (timer.current) window.clearTimeout(timer.current);
      await api.action(conversation.id, "confirm_crop", { crop: effective });
    } catch (e: any) {
      toast(e?.message || "Could not confirm the crop", "error");
    } finally {
      setConfirming(false);
    }
  };

  const busy = conversation.busy || confirming;

  return (
    <div className="cpanel">
      <div className="cpanel__head">
        <div className="cpanel__title">
          <strong>Crop your plan</strong>
          <span>Drag the handles so only the floor plan is inside the frame</span>
        </div>
        <button className="btn btn--sm btn--ghost" disabled={busy || !full} onClick={() => full && onChange(full)}>
          <Icon name="fit" size={15} /> <span className="hide-sm">Full image</span>
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close canvas">
          <Icon name="close" />
        </button>
      </div>

      <div className="crop-body">
        <CropCanvas
          imageUrl={files?.planOriginalUrl || null}
          crop={effective}
          onChange={(c) => onChange(c)}
          onImageSize={(s) => setImgSize(s)}
          disabled={busy}
        />
        <aside className="crop-side">
          <p>Crop tight to the outer walls. Leave out titles, legends, margins and the table it is lying on.</p>
          <figure className="crop-example good" style={{ margin: 0 }}>
            <img src="/examples/crop-good.png" alt="Good crop: only the plan, edge to edge" />
            <span>
              <Icon name="check" size={14} /> Good crop
            </span>
          </figure>
          <figure className="crop-example bad" style={{ margin: 0 }}>
            <img src="/examples/crop-bad.png" alt="Bad crop: wide margins and title block" />
            <span>
              <Icon name="close" size={14} /> Bad crop
            </span>
          </figure>
        </aside>
      </div>

      <div className="cpanel__foot">
        <span className="grow">{effective ? `${effective.width} × ${effective.height} px selected` : "Loading…"}</span>
        <button className="btn btn--primary" onClick={confirm} disabled={busy || !effective}>
          {confirming ? <Spinner /> : <Icon name="check" size={16} />} Confirm crop
        </button>
      </div>
    </div>
  );
}
