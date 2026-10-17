// Drives the camera along a planned tour (live preview), and renders it frame by frame for the MP4 export.
// Lives inside the R3F <Canvas>. The panel switches the Canvas to frameloop "never" + the export pixel ratio
// before calling exportVideo, so every frame is rendered on demand with advance().
import { forwardRef, useEffect, useImperativeHandle, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import { sampleTour, type Tour, type TourFrame } from "./cinematic";
import { drawTourOverlay, encodeVideo } from "./exportVideo";
import { FOV } from "./IsoCamera";

export interface TourApi {
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
  tour: Tour;
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
      exportVideo: async ({ width, height, fps, font, signal, onProgress }) => {
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
