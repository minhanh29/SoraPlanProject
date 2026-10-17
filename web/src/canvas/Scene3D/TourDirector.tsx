// Drives the camera along a planned tour (live preview), renders candidate previews for the AI director, and
// renders the tour frame by frame for the MP4 export. Lives inside the R3F <Canvas>. The panel switches the
// Canvas to frameloop "never" + the target pixel ratio before renderStills / exportVideo, so every frame is
// rendered on demand with advance().
import { forwardRef, useEffect, useImperativeHandle, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import { sampleTour, type Tour, type TourFrame } from "./cinematic";
import { drawTourOverlay, encodeVideo } from "./exportVideo";
import { FOV } from "./IsoCamera";

export interface StillPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface TourApi {
  /** One JPEG (base64, no data: prefix) per pose, `width × height`, interior lighting on. */
  renderStills: (poses: StillPose[], width: number, height: number) => Promise<string[]>;
  exportVideo: (opts: {
    width: number;
    height: number;
    fps: number;
    font: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  }) => Promise<Blob>;
}

interface Props {
  /** null while the tour is being planned (the camera is only moved by renderStills). */
  tour: Tour | null;
  playing: boolean;
  /** Tour time (s); owned by the panel so it can seek / restart. */
  timeRef: MutableRefObject<number>;
  /** Set every frame: interior shot on screen (ceilings and room lights). */
  interiorRef: MutableRefObject<boolean>;
  composerRef: MutableRefObject<EffectComposerImpl | null>;
  /** Resolves once every item's GLB is loaded (the export must not show placeholders). */
  preload: () => Promise<void>;
  onFrame: (f: TourFrame) => void;
  onEnd: () => void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TourDirector = forwardRef<TourApi, Props>(function TourDirector(
  { tour, playing, timeRef, interiorRef, composerRef, preload, onFrame, onEnd },
  ref,
) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const advance = useThree((s) => s.advance);
  const size = useThree((s) => s.size);
  const exporting = useRef(false);
  const ended = useRef(false);
  const target = useRef(new THREE.Vector3());
  const still = useRef<TourFrame | null>(null);

  const apply = (f: TourFrame) => {
    camera.position.set(...f.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(target.current.set(...f.target));
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera) {
      cam.fov = f.fov;
      cam.near = 0.05;
      cam.far = 400;
      cam.updateProjectionMatrix();
    }
    interiorRef.current = f.interior;
    onFrame(f);
  };

  useFrame((_, delta) => {
    if (still.current) {
      apply(still.current);
      return;
    }
    if (!tour) return;
    if (!exporting.current && playing) timeRef.current = Math.min(tour.duration, timeRef.current + Math.min(delta, 0.1));
    apply(sampleTour(tour, timeRef.current));
    if (exporting.current || !playing) {
      ended.current = false;
      return;
    }
    if (timeRef.current >= tour.duration && !ended.current) {
      ended.current = true;
      onEnd();
    }
  });

  // Leaving the tour: interior off, the orbit camera's lens back
  useEffect(
    () => () => {
      interiorRef.current = false;
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera) {
        cam.fov = FOV;
        cam.updateProjectionMatrix();
      }
    },
    [camera, interiorRef],
  );

  useImperativeHandle(
    ref,
    () => ({
      renderStills: async (poses, width, height) => {
        exporting.current = true;
        try {
          await preload();
          await wait(120);
          composerRef.current?.setSize(size.width, size.height);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d", { alpha: false })!;
          const out: string[] = [];
          for (let i = 0; i < poses.length; i++) {
            const p = poses[i];
            still.current = { position: p.position, target: p.target, fov: p.fov, interior: true, fade: 0, caption: null, captionAlpha: 0, shotIndex: 0 };
            // First pose: a few extra renders compile shaders / upload textures
            for (let k = 0; k < (i === 0 ? 4 : 1); k++) advance(performance.now());
            ctx.drawImage(gl.domElement, 0, 0, width, height);
            out.push(canvas.toDataURL("image/jpeg", 0.72).split(",")[1]);
            if (i % 4 === 3) await wait(0); // keep the page responsive
          }
          return out;
        } finally {
          still.current = null;
          exporting.current = false;
        }
      },
      exportVideo: async ({ width, height, fps, font, signal, onProgress }) => {
        if (!tour) throw new Error("The tour is not ready yet");
        exporting.current = true;
        try {
          await preload();
          await wait(120); // let the loaded models mount
          composerRef.current?.setSize(size.width, size.height); // composer buffers follow the export pixel ratio
          // Warm-up: compile shaders and upload textures before frame 0
          for (let i = 0; i < 4; i++) {
            timeRef.current = 0;
            advance(performance.now());
            await wait(16);
          }
          const frameCount = Math.ceil(tour.duration * fps);
          return await encodeVideo({
            width,
            height,
            fps,
            frameCount,
            signal,
            onProgress,
            drawFrame: (i, ctx) => {
              const t = i / fps;
              timeRef.current = t;
              advance(performance.now()); // runs useFrame (camera) and renders, synchronously
              ctx.drawImage(gl.domElement, 0, 0, width, height); // same task: the drawing buffer is still valid
              drawTourOverlay(ctx, sampleTour(tour, t), width, height, font);
            },
          });
        } finally {
          exporting.current = false;
        }
      },
    }),
    [tour, advance, gl, preload, composerRef, timeRef, size.width, size.height],
  );

  return null;
});

export default TourDirector;
