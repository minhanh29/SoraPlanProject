// Rich chat cards rendered per message kind (copy from messageTemplates.ts).
import { useEffect, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type {
  Conversation,
  MappingResultPayload,
  Message,
  SceneChangePayload,
  StyleId,
  StylePickerPayload,
} from "../../lib/types";
import { useJob } from "../../hooks/useConversations";
import { ConfirmDialog, Icon, Spinner, toast } from "../../components/ui";
import { PARSE_STAGES } from "../messageTemplates";

export interface CardProps {
  message: Message;
  conversation: Conversation;
  isLatest: boolean;
  openCanvas: () => void;
}

async function run(conv: Conversation, type: Parameters<typeof api.action>[1], args: Record<string, unknown> = {}) {
  try {
    await api.action(conv.id, type, args);
    return true;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : "Something went wrong", "error");
    return false;
  }
}

function CardActions({ children }: { children: React.ReactNode }) {
  return <div className="card-actions">{children}</div>;
}

export function CropRequestCard({ conversation, isLatest, openCanvas }: CardProps) {
  return (
    <>
      <div className="crop-examples">
        <figure><img src="/examples/crop-good.png" alt="Good crop: tight around the walls" /><figcaption>Good: tight around the walls</figcaption></figure>
        <figure><img src="/examples/crop-bad.png" alt="Bad crop: margins and labels included" /><figcaption>Bad: margins, labels, tilted</figcaption></figure>
      </div>
      {isLatest && conversation.stage === "cropping" && (
        <CardActions>
          <button className="btn btn--sm" onClick={openCanvas}><Icon name="fit" size={16} /> Open crop</button>
        </CardActions>
      )}
    </>
  );
}

export function ParseProgressCard({ message, conversation }: CardProps) {
  const job = useJob(message.payload?.jobId || null);
  const status = job?.status || "queued";
  const stage = job?.stage || "queued";
  // detecting_room_corners only runs for uncropped uploads; map it onto the AI step
  const effective = stage === "detecting_room_corners" ? "analyzing_with_ai" : stage;
  const idx = Math.max(0, PARSE_STAGES.findIndex((s) => s.key === effective));
  const done = status === "completed";
  const failed = status === "failed";

  // Safety net: if the worker went quiet, ask the API (it marks stale jobs failed and resets the chat)
  useEffect(() => {
    if (done || failed || !message.payload?.jobId) return;
    const t = window.setInterval(() => {
      api.job(message.payload.jobId).catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(t);
  }, [done, failed, message.payload?.jobId]);

  if (conversation.stage !== "parsing" && !done && !failed) return null;
  return (
    <ol className={`parse-steps ${done ? "is-done" : ""}`}>
      {PARSE_STAGES.slice(1).map((s, i) => {
        const state = done || i + 1 < idx ? "done" : i + 1 === idx || (idx === 0 && i === 0) ? (failed ? "failed" : "active") : "todo";
        return (
          <li key={s.key} className={`parse-step is-${state}`}>
            <span className="parse-step__dot">{state === "done" ? <Icon name="check" size={12} /> : state === "active" ? <Spinner size={10} /> : null}</span>
            <span className={state === "active" ? "shimmer-text" : ""}>{s.label}</span>
          </li>
        );
      })}
      {job && !done && !failed && <li className="parse-progress"><span style={{ width: `${Math.max(5, job.progress || 0)}%` }} /></li>}
    </ol>
  );
}

export function PlanReadyCard({ conversation, isLatest, openCanvas }: CardProps) {
  if (!isLatest || conversation.stage !== "reviewing_plan") return null;
  return (
    <CardActions>
      <button className="btn btn--sm" onClick={openCanvas}><Icon name="grid" size={16} /> Review plan</button>
      <button className="btn btn--sm btn--primary" disabled={conversation.busy} onClick={() => run(conversation, "confirm_plan")}>
        <Icon name="check" size={16} /> Looks right
      </button>
    </CardActions>
  );
}

export function PlanFailedCard({ message, conversation, isLatest, openCanvas }: CardProps) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      {message.payload?.error && <p className="card-detail">{String(message.payload.error).slice(0, 240)}</p>}
      {isLatest && conversation.stage === "cropping" && (
        <CardActions>
          <button className="btn btn--sm btn--primary" disabled={busy || conversation.busy}
            onClick={async () => { setBusy(true); await run(conversation, "retry_parse"); setBusy(false); }}>
            {busy ? <Spinner /> : <Icon name="rotate" size={16} />} Try again
          </button>
          <button className="btn btn--sm" onClick={openCanvas}><Icon name="fit" size={16} /> Re-crop</button>
        </CardActions>
      )}
    </>
  );
}

export function StylePickerCard({ message, conversation }: CardProps) {
  const p = message.payload as StylePickerPayload;
  const [pending, setPending] = useState<StyleId | null>(null);
  const [confirm, setConfirm] = useState<StyleId | null>(null);
  const selectable = ["choosing_style", "resolving_missing", "scene_ready"].includes(conversation.stage);
  const choose = async (id: StyleId) => {
    if (conversation.stage === "scene_ready") return setConfirm(id);
    setPending(id);
    await run(conversation, "select_style", { style: id });
    setPending(null);
  };
  return (
    <>
      <div className="style-cards">
        {(p.styles || []).map((s) => (
          <button key={s.id} className={`style-card ${p.selected === s.id ? "is-selected" : ""}`}
            disabled={!selectable || conversation.busy || pending !== null} onClick={() => choose(s.id)}>
            <img src={s.coverUrl} alt="" loading="lazy" />
            <span className="style-card__name">{pending === s.id ? <Spinner /> : null} {s.name}</span>
            {s.blurb && <span className="style-card__blurb">{s.blurb}</span>}
          </button>
        ))}
      </div>
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title="Change the style?" danger={false}
        confirmLabel="Rebuild in this style"
        message="The 3D home will be rebuilt with the new collection. Changes you made in 3D are replaced."
        onConfirm={async () => { if (confirm) await run(conversation, "select_style", { style: confirm }); }} />
    </>
  );
}

export function MappingResultCard({ message, conversation, isLatest, openCanvas }: CardProps) {
  const p = message.payload as MappingResultPayload;
  const active = isLatest && conversation.stage === "resolving_missing";
  return (
    <>
      {!!p.missing?.length && (
        <div className="chip-row">
          {p.missing.slice(0, 12).map((m) => (
            <span key={m.componentId} className="pill pill--warning">{m.label}</span>
          ))}
          {p.missing.length > 12 && <span className="pill">+{p.missing.length - 12}</span>}
        </div>
      )}
      {active && (
        <CardActions>
          <button className="btn btn--sm btn--primary" onClick={openCanvas}><Icon name="upload" size={16} /> Resolve missing</button>
          <button className="btn btn--sm" disabled={conversation.busy} onClick={() => run(conversation, "skip_missing")}>Skip all</button>
        </CardActions>
      )}
    </>
  );
}

export function SceneReadyCard({ conversation, isLatest, openCanvas }: CardProps) {
  if (!isLatest && conversation.stage !== "scene_ready") return null;
  return (
    <CardActions>
      <button className="btn btn--sm btn--primary" onClick={openCanvas}><Icon name="cube" size={16} /> Open 3D</button>
    </CardActions>
  );
}

export function SceneChangeCard({ message, conversation }: CardProps) {
  const p = message.payload as SceneChangePayload & { batchIds?: string[] };
  const [busy, setBusy] = useState(false);
  return (
    <div className="scene-change">
      <Icon name="check" size={16} />
      <span className={p.undone ? "is-undone" : ""}>{p.summary}</span>
      {conversation.stage === "scene_ready" && !p.undone && (
        <button className="btn btn--sm btn--ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          await run(conversation, "undo_last_change", { batchIds: p.batchIds || [p.batchId], messageId: message.id });
          setBusy(false);
        }}>
          {busy ? <Spinner /> : <Icon name="undo" size={16} />} Undo
        </button>
      )}
      {p.undone && <span className="pill">Undone</span>}
    </div>
  );
}

export function ErrorCard({ message, conversation }: CardProps) {
  const p = message.payload || {};
  return (
    <div className="error-card" role="alert">
      <strong>{p.message || "Something went wrong."}</strong>
      {p.retryAction && (
        <button className="btn btn--sm" onClick={() => run(conversation, p.retryAction)}>Retry</button>
      )}
    </div>
  );
}
