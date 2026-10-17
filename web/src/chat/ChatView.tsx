import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useConversation, useMessages, useProject } from "../hooks/useConversations";
import { useProjectFiles } from "../hooks/useProjectFiles";
import { api, ApiError } from "../lib/api";
import { Spinner, toast } from "../components/ui";
import { STAGE_SCENE, useBackdrop } from "../components/Backdrop";
import CanvasPane, { CANVAS_STAGES } from "../canvas/CanvasPane";
import UploadAssetDialog from "../assets/UploadAssetDialog";
import Composer from "./Composer";
import EmptyState from "./EmptyState";
import MessageList from "./MessageList";
import "./chat.css";

const SPLIT_KEY = "soraplan.chatWidth";
const MIN_CHAT = 320;

function useIsMobile() {
  const q = "(max-width: 899px)";
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mql = window.matchMedia(q);
    const on = () => setM(mql.matches);
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, []);
  return m;
}

export default function ChatView() {
  const { projectId } = useParams();
  if (!projectId) return <NewChat />;
  return <ProjectChat key={projectId} id={projectId} />;
}

function NewChat() {
  return (
    <div className="chat chat--empty">
      <EmptyState />
    </div>
  );
}

function ProjectChat({ id }: { id: string }) {
  const conversation = useConversation(id);
  const project = useProject(id);
  const messages = useMessages(id);
  const files = useProjectFiles(id, `${project?.planImage?.storagePath}|${project?.planImageOriginal?.storagePath}`);
  const mobile = useIsMobile();
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(SPLIT_KEY)) || 400;
    } catch {
      return 400;
    }
  });
  const lastStage = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useBackdrop(conversation ? STAGE_SCENE[conversation.stage] ?? null : null);

  // Open the canvas automatically when the flow enters a stage that needs it
  const stage = conversation?.stage;
  useEffect(() => {
    if (!stage) return;
    if (lastStage.current !== stage) {
      const first = lastStage.current === null;
      lastStage.current = stage;
      const needs = CANVAS_STAGES.includes(stage);
      if (needs && !(first && mobile)) setCanvasOpen(true);
      if (!needs) setCanvasOpen(false);
    }
  }, [stage, mobile]);

  const openCanvas = useCallback(() => {
    if (stage && CANVAS_STAGES.includes(stage)) setCanvasOpen(true);
  }, [stage]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const left = root.getBoundingClientRect().left;
    const max = root.clientWidth * 0.6;
    const move = (ev: PointerEvent) => setChatWidth(Math.round(Math.max(MIN_CHAT, Math.min(max, ev.clientX - left))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-resizing");
      setChatWidth((w) => {
        try {
          localStorage.setItem(SPLIT_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (conversation === undefined || project === undefined)
    return <div className="chat chat--loading"><Spinner size={20} /></div>;
  if (conversation === null || project === null)
    return (
      <div className="chat chat--loading">
        <div className="chat__missing">
          <img src="/art/obj-plans.webp" alt="" width={160} height={160} />
          <p className="muted">This project doesn't exist or was deleted.</p>
        </div>
      </div>
    );

  const responding = conversation.busy && conversation.busyReason === "gemini";
  const showCanvas = canvasOpen && CANVAS_STAGES.includes(conversation.stage);

  const send = (text: string) => {
    api.sendMessage(id, text).catch((e) => toast(e instanceof ApiError ? e.message : "Message failed", "error"));
  };

  return (
    <div ref={rootRef} className={`chat ${showCanvas ? "chat--split" : ""} ${showCanvas && mobile ? "chat--sheet" : ""}`}
      style={showCanvas && !mobile ? ({ "--chat-w": `${chatWidth}px` } as React.CSSProperties) : undefined}>
      <div className="chat__column">
        <header className="chat__head">
          <h1 title={conversation.title}>{conversation.title}</h1>
          {!showCanvas && CANVAS_STAGES.includes(conversation.stage) && (
            <button className="btn btn--sm" onClick={() => setCanvasOpen(true)}>Open canvas</button>
          )}
        </header>
        {messages === undefined ? (
          <div className="chat--loading"><Spinner /></div>
        ) : (
          <MessageList messages={messages} conversation={conversation} openCanvas={openCanvas} />
        )}
        <div className="chat__composer">
          <Composer
            onSend={send}
            onStop={() => api.stop(id).catch(() => undefined)}
            onAttach={() => setAttachOpen(true)}
            responding={responding}
            disabled={conversation.stage === "uploading"}
            placeholder={conversation.stage === "scene_ready" ? "Ask for a change — “move the sofa 50 cm left”" : "Ask SoraPlan…"}
          />
        </div>
      </div>
      {showCanvas && !mobile && <div className="chat__divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" />}
      {showCanvas && (
        <CanvasPane conversation={conversation} project={project} files={files} onClose={() => setCanvasOpen(false)} mobile={mobile} />
      )}
      <UploadAssetDialog open={attachOpen} onClose={() => setAttachOpen(false)}
        onUploaded={() => toast("Added to Your assets — it will turn 3D in a few minutes", "success")} />
    </div>
  );
}
