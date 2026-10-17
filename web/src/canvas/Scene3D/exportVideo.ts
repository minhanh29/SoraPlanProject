// Offline video export: every frame is rendered on demand, composited with the tour's captions and fades on a
// 2D canvas, encoded with WebCodecs (H.264, else VP9/AV1) and muxed into an MP4 in memory. Frame-exact and
// smooth whatever the machine's speed (unlike recording the live canvas in real time).
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { TourFrame } from "./cinematic";

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  /** Draw frame `i` onto `ctx` (width × height). */
  drawFrame: (i: number, ctx: CanvasRenderingContext2D) => void | Promise<void>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

type Codec = { config: VideoEncoderConfig; muxer: "avc" | "vp9" | "av1" };

export const canExportVideo = () => typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;

async function pickCodec(width: number, height: number, fps: number): Promise<Codec | null> {
  const bitrate = Math.round(width * height * fps * 0.2); // ≈ 12 Mbps at 1080p30
  const candidates: Codec[] = [
    { muxer: "avc", config: { codec: "avc1.640028", width, height, bitrate, framerate: fps, avc: { format: "avc" } } },
    { muxer: "avc", config: { codec: "avc1.4d0028", width, height, bitrate, framerate: fps, avc: { format: "avc" } } },
    { muxer: "vp9", config: { codec: "vp09.00.40.08", width, height, bitrate, framerate: fps } },
    { muxer: "av1", config: { codec: "av01.0.08M.08", width, height, bitrate, framerate: fps } },
  ];
  for (const c of candidates) {
    try {
      if ((await VideoEncoder.isConfigSupported(c.config)).supported) return c;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

export async function encodeVideo({ width, height, fps, frameCount, drawFrame, onProgress, signal }: EncodeOptions): Promise<Blob> {
  if (!canExportVideo()) throw new Error("Video export needs a recent Chrome, Edge or Safari.");
  const codec = await pickCodec(width, height, fps);
  if (!codec) throw new Error("This browser cannot encode video at this size.");

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: codec.muxer, width, height, frameRate: fps },
    fastStart: "in-memory",
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure(codec.config);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  try {
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      if (failure) throw failure;
      await drawFrame(i, ctx);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      // Back-pressure: don't queue more than a few frames ahead of the encoder
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      onProgress?.(i + 1, frameCount);
      await nextTask(); // let the progress UI paint
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

/** Captions and dips to black, drawn exactly like the live preview's DOM overlay (TourOverlay). */
export function drawTourOverlay(ctx: CanvasRenderingContext2D, f: TourFrame, width: number, height: number, font: string) {
  const s = height / 1080; // design at 1080p
  if (f.caption && f.captionAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = f.captionAlpha;
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 18 * s;
    ctx.fillStyle = "#fff";
    if (f.caption.style === "title") {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 ${76 * s}px ${font}`;
      ctx.fillText(f.caption.title, width / 2, height / 2 - (f.caption.subtitle ? 24 * s : 0));
      if (f.caption.subtitle) {
        ctx.font = `400 ${30 * s}px ${font}`;
        ctx.globalAlpha = f.captionAlpha * 0.85;
        ctx.fillText(f.caption.subtitle.toUpperCase(), width / 2, height / 2 + 52 * s);
      }
    } else {
      const x = 96 * s;
      const y = height - 120 * s;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillRect(x, y - 64 * s, 56 * s, 3 * s); // accent rule above the name
      ctx.font = `600 ${52 * s}px ${font}`;
      ctx.fillText(f.caption.title, x, y);
      if (f.caption.subtitle) {
        ctx.font = `400 ${26 * s}px ${font}`;
        ctx.globalAlpha = f.captionAlpha * 0.85;
        ctx.fillText(f.caption.subtitle, x, y + 40 * s);
      }
    }
    ctx.restore();
  }
  if (f.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${f.fade})`;
    ctx.fillRect(0, 0, width, height);
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
