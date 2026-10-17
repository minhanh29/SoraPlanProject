// Tour controls: play/pause, restart, scrubber with time, export (1080p / 720p) and exit. The scrubber and
// clock follow the tour time from a rAF loop (no React re-render per frame).
import { useEffect, useRef, type MutableRefObject } from "react";
import { Icon, Spinner } from "../../components/ui";

interface Props {
  duration: number;
  timeRef: MutableRefObject<number>;
  playing: boolean;
  /** Export progress 0..1, or null when not exporting. */
  exportProgress: number | null;
  canExport: boolean;
  onPlayPause: () => void;
  onRestart: () => void;
  onSeek: (t: number) => void;
  onExport: (height: 1080 | 720) => void;
  onCancelExport: () => void;
  onExit: () => void;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function TourBar(p: Props) {
  const range = useRef<HTMLInputElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = p.timeRef.current;
      if (range.current && document.activeElement !== range.current) range.current.value = String(t);
      if (time.current) time.current.textContent = `${clock(t)} / ${clock(p.duration)}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.timeRef, p.duration]);

  const exporting = p.exportProgress !== null;
  return (
    <>
      <div className="s3d-tourbar" role="toolbar" aria-label="Tour">
        <button className="icon-btn" onClick={p.onPlayPause} disabled={exporting} aria-label={p.playing ? "Pause" : "Play"} title={p.playing ? "Pause" : "Play"}>
          <Icon name={p.playing ? "pause" : "play"} />
        </button>
        <button className="icon-btn" onClick={p.onRestart} disabled={exporting} aria-label="Restart" title="Restart">
          <Icon name="undo" />
        </button>
        <input
          ref={range}
          className="s3d-tourbar__range"
          type="range"
          min={0}
          max={p.duration}
          step={0.01}
          defaultValue={0}
          disabled={exporting}
          aria-label="Tour position"
          onInput={(e) => p.onSeek(Number((e.target as HTMLInputElement).value))}
        />
        <span ref={time} className="s3d-tourbar__time" />
        <div className="s3d-tourbar__export">
          <button className="btn btn--sm btn--primary" disabled={exporting || !p.canExport} onClick={() => p.onExport(1080)}
            title={p.canExport ? "Render the tour to an MP4 file (1920×1080, 30 fps)" : "Video export needs a recent Chrome, Edge or Safari"}>
            <Icon name="download" size={14} /> Export 1080p
          </button>
          <button className="btn btn--sm" disabled={exporting || !p.canExport} onClick={() => p.onExport(720)} title="Faster export at 1280×720">
            720p
          </button>
        </div>
        <button className="icon-btn" onClick={p.onExit} aria-label="Exit tour" title="Exit tour">
          <Icon name="close" />
        </button>
      </div>
      {exporting && (
        <div className="s3d-export card" role="status" aria-live="polite">
          <div className="s3d-export__head">
            <Spinner size={14} /> <strong>Rendering video…</strong> <span className="subtle">{Math.round((p.exportProgress || 0) * 100)}%</span>
          </div>
          <div className="s3d-export__bar">
            <div style={{ width: `${Math.round((p.exportProgress || 0) * 100)}%` }} />
          </div>
          <p className="subtle">Every frame is rendered at full quality and saved as an MP4. Keep this tab open.</p>
          <button className="btn btn--sm" onClick={p.onCancelExport}>Cancel</button>
        </div>
      )}
    </>
  );
}
