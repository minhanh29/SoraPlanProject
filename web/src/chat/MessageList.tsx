import { useEffect, useLayoutEffect, useRef } from "react";
import type { Conversation, Message } from "../lib/types";
import MessageItem from "./MessageItem";

const BUSY_LABEL: Record<string, string> = {
  mapping: "Placing furniture from the catalog…",
  building: "Building your 3D home…",
};

export default function MessageList({
  messages,
  conversation,
  openCanvas,
}: {
  messages: Message[];
  conversation: Conversation;
  openCanvas: (kind?: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCard = [...messages].reverse().find((m) => m.kind !== "text" && m.kind !== "scene_change");

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const busyLabel = conversation.busy && conversation.busyReason ? BUSY_LABEL[conversation.busyReason] : null;

  return (
    <div className="msg-list" ref={ref}>
      <div className="msg-list__inner">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} conversation={conversation} isLatest={m.id === lastCard?.id}
            openCanvas={() => openCanvas(m.kind)} />
        ))}
        {busyLabel && (
          <div className="msg msg--assistant">
            <div className="msg__avatar" aria-hidden="true"><img src="/favicon.svg" alt="" width={22} height={22} /></div>
            <div className="msg__body"><span className="shimmer-text">{busyLabel}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}
