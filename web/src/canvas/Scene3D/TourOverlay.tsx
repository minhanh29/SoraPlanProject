// Live-preview captions and dips to black over the tour (same layout as exportVideo.drawTourOverlay, which
// burns them into the video). Updated imperatively every frame: no React re-render at 60 fps.
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { TourFrame } from "./cinematic";

export interface TourOverlayApi {
  update: (f: TourFrame) => void;
}

const TourOverlay = forwardRef<TourOverlayApi>(function TourOverlay(_, ref) {
  const fade = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const subtitle = useRef<HTMLDivElement>(null);
  const last = useRef("");

  useImperativeHandle(ref, () => ({
    update: (f) => {
      if (fade.current) fade.current.style.opacity = String(f.fade);
      const c = caption.current;
      if (!c) return;
      const key = f.caption ? `${f.caption.style}|${f.caption.title}|${f.caption.subtitle || ""}` : "";
      if (key !== last.current) {
        last.current = key;
        c.className = `s3d-tour__caption s3d-tour__caption--${f.caption?.style || "lower"}`;
        if (title.current) title.current.textContent = f.caption?.title || "";
        if (subtitle.current) subtitle.current.textContent = f.caption?.subtitle || "";
      }
      c.style.opacity = String(f.captionAlpha);
    },
  }));

  return (
    <div className="s3d-tour__overlay" aria-hidden="true">
      <div ref={caption} className="s3d-tour__caption" style={{ opacity: 0 }}>
        <div className="s3d-tour__rule" />
        <div ref={title} className="s3d-tour__title" />
        <div ref={subtitle} className="s3d-tour__subtitle" />
      </div>
      <div ref={fade} className="s3d-tour__fade" style={{ opacity: 1 }} />
    </div>
  );
});

export default TourOverlay;
