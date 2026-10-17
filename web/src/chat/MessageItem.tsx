import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../lib/types";
import { renderTemplate } from "./messageTemplates";
import {
  CropRequestCard,
  ErrorCard,
  MappingResultCard,
  ParseProgressCard,
  PlanFailedCard,
  PlanReadyCard,
  SceneChangeCard,
  SceneReadyCard,
  StylePickerCard,
  type CardProps,
} from "./kinds/cards";

const CARDS: Partial<Record<Message["kind"], (p: CardProps) => JSX.Element | null>> = {
  crop_request: CropRequestCard,
  parse_started: ParseProgressCard,
  plan_ready: PlanReadyCard,
  plan_failed: PlanFailedCard,
  style_picker: StylePickerCard,
  mapping_result: MappingResultCard,
  scene_ready: SceneReadyCard,
  scene_change: SceneChangeCard,
  error: ErrorCard,
};

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>
      {text}
    </ReactMarkdown>
  );
}

function MessageItem({ message, conversation, isLatest, openCanvas }: CardProps) {
  if (message.role === "user") {
    return (
      <div className="msg msg--user">
        <div className="msg__bubble"><Markdown text={message.text} /></div>
      </div>
    );
  }
  const Card = CARDS[message.kind];
  const text = message.kind === "text" || message.kind === "scene_change" ? message.text : renderTemplate(message.kind, message.payload);
  const streaming = message.status === "streaming";
  if (message.kind === "text" && !text && !streaming && message.status !== "error") return null;
  return (
    <div className={`msg msg--assistant msg--${message.kind}`}>
      <div className="msg__avatar" aria-hidden="true"><img src="/favicon.svg" alt="" width={22} height={22} /></div>
      <div className="msg__body">
        {streaming && !text ? (
          <div className="typing" aria-label="Thinking"><span /><span /><span /></div>
        ) : (
          text && message.kind !== "scene_change" && (
            <div className={`msg__text ${streaming ? "is-streaming" : ""}`}><Markdown text={text} /></div>
          )
        )}
        {message.status === "error" && message.kind === "text" && <p className="msg__error">This reply was interrupted.</p>}
        {Card && <Card message={message} conversation={conversation} isLatest={isLatest} openCanvas={openCanvas} />}
      </div>
    </div>
  );
}

export default memo(MessageItem);
