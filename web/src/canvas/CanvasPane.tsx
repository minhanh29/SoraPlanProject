import { Suspense, lazy } from "react";
import type { Conversation, Project, ProjectFiles, Stage } from "../lib/types";
import { Icon, Spinner } from "../components/ui";
import CropPanel from "./CropPanel";
import PlanReviewPanel from "./PlanReviewPanel";
import MappingPanel from "./MappingPanel";

// three.js is the heaviest chunk: load it only when a 3D scene is opened
const Scene3DPanel = lazy(() => import("./Scene3D/Scene3DPanel"));

export const CANVAS_STAGES: Stage[] = ["cropping", "reviewing_plan", "resolving_missing", "scene_ready"];

export default function CanvasPane({
  conversation,
  project,
  files,
  onClose,
  mobile,
}: {
  conversation: Conversation;
  project: Project;
  files: ProjectFiles | null;
  onClose: () => void;
  mobile: boolean;
}) {
  const props = { conversation, project, files, onClose };
  let panel: JSX.Element | null = null;
  switch (conversation.stage) {
    case "cropping":
      panel = <CropPanel key={`crop-${project.planImageOriginal?.storagePath}`} {...props} />;
      break;
    case "reviewing_plan":
      panel = <PlanReviewPanel {...props} />;
      break;
    case "resolving_missing":
      panel = <MappingPanel {...props} />;
      break;
    case "scene_ready":
      panel = (
        <Suspense fallback={<div className="canvas-loading"><Spinner size={20} /> Loading 3D…</div>}>
          <Scene3DPanel {...props} />
        </Suspense>
      );
      break;
  }
  return (
    <section className="canvas-pane" aria-label="Canvas">
      {mobile && (
        <div className="canvas-pane__back">
          <button className="btn btn--sm btn--ghost" onClick={onClose}><Icon name="back" size={16} /> Back to chat</button>
        </div>
      )}
      <div className="canvas-pane__body">{panel}</div>
    </section>
  );
}
