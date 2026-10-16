import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Icon } from "../components/ui";

export default function Composer({
  onSend,
  onStop,
  onAttach,
  responding,
  disabled,
  placeholder = "Ask SoraPlan…",
  autoFocus,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  onAttach?: (file?: File) => void;
  responding?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);

  // Auto-grow 1–6 lines
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 24;
    el.style.height = `${Math.min(el.scrollHeight, line * 6 + 12)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || responding || disabled) return;
    onSend(t);
    setText("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData.files || [])[0];
    if (file && onAttach) {
      e.preventDefault();
      onAttach(file);
    }
  };

  return (
    <div className={`composer ${disabled ? "is-disabled" : ""}`}>
      {onAttach && (
        <button className="icon-btn" onClick={() => onAttach()} aria-label="Attach a file" title="Attach">
          <Icon name="attach" />
        </button>
      )}
      <textarea
        ref={ta}
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label="Message"
      />
      {responding ? (
        <button className="composer__send is-stop" onClick={onStop} aria-label="Stop">
          <Icon name="stop" size={16} />
        </button>
      ) : (
        <button className="composer__send" onClick={send} disabled={!text.trim() || disabled} aria-label="Send">
          <Icon name="send" size={18} />
        </button>
      )}
    </div>
  );
}
