import type { Conversation, Project, ProjectFiles } from "../lib/types";

/** Props every canvas panel receives from CanvasPane. */
export interface PanelProps {
  conversation: Conversation;
  project: Project;
  /** Fresh signed URLs for the original upload and the cropped plan image. */
  files: ProjectFiles | null;
  /** Close the canvas (back to chat-only on desktop, "Back to chat" on mobile). */
  onClose: () => void;
}
