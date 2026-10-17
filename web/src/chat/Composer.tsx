import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Icon } from "../components/ui";

const LINE = 24; // px, matches .composer textarea line-height
const MAX_LINES = 6;

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

  // Auto-grow 1–6 lines. Re-measured when the text, the placeholder, the width or the web font changes: on a
  // reload the composer mounts before the conversation (short placeholder, final width unknown).
  const fit = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    const max = LINE * MAX_LINES + 12;
    el.style.height = "auto";
    let h = el.scrollHeight;
    if (!el.value && el.placeholder) {
      // An empty box is as tall as its (possibly wrapping) placeholder
      el.value = el.placeholder;
      h = el.scrollHeight;
      el.value = "";
    }
    el.style.height = `${Math.min(h, max)}px`;
    el.style.overflowY = h > max ? "auto" : "hidden"; // scrollbar only past the 6-line cap
  }, []);
  useLayoutEffect(fit, [text, placeholder, fit]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    document.fonts?.ready.then(fit).catch(() => undefined);
    return () => ro.disconnect();
  }, [fit]);

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
