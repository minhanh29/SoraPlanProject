// Orthographic isometric camera rig: fits the scene bounds, animates between views
// (intro top-down → iso, Reset view, focus on an item) and clamps orbiting to 20°–80° elevation.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

export const ISO_ELEVATION = THREE.MathUtils.degToRad(35.26);
export const ISO_AZIMUTH = THREE.MathUtils.degToRad(45);
const MIN_ELEVATION = THREE.MathUtils.degToRad(20);
const MAX_ELEVATION = THREE.MathUtils.degToRad(80);
const RADIUS = 80;

export interface Box3Like {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface CameraApi {
  /** Animate back to the isometric view fitted to the whole scene. */
  reset: () => void;
  /** Animate to frame one box (e.g. an item on double-click). */
  focus: (box: Box3Like) => void;
}

interface ViewState {
  el: number;
  az: number;
  target: THREE.Vector3;
  zoom: number;
}

interface Anim {
  t0: number;
  dur: number;
  from: ViewState;
  to: ViewState;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function offset(el: number, az: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(RADIUS);
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return from + d;
}

interface Props {
  bounds: Box3Like;
  /** True while a gizmo drag is active (controls disabled). */
  locked: boolean;
}

const IsoCamera = forwardRef<CameraApi, Props>(function IsoCamera({ bounds, locked }, ref) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const anim = useRef<Anim | null>(null);
  const started = useRef(false);

  /** Zoom that frames `box` when viewed from (el, az). */
  const fitZoom = useCallback(
    (box: Box3Like, el: number, az: number, margin = 0.82) => {
      const target = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
      const probe = new THREE.Object3D();
      probe.position.copy(target).add(offset(el, az));
      probe.up.set(0, 1, 0);
      probe.lookAt(target);
      probe.updateMatrixWorld();
      const inv = probe.matrixWorld.clone().invert();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
          }
      const w = Math.max(maxX - minX, 0.5);
      const h = Math.max(maxY - minY, 0.5);
      return { target, zoom: Math.min(size.width / w, size.height / h) * margin };
    },
    [size.width, size.height],
  );

  const current = useCallback((): ViewState => {
    const target = controlsRef.current?.target.clone() ?? new THREE.Vector3();
    const off = camera.position.clone().sub(target);
    const len = Math.max(off.length(), 1e-6);
    return { el: Math.asin(THREE.MathUtils.clamp(off.y / len, -1, 1)), az: Math.atan2(off.x, off.z), target, zoom: camera.zoom };
  }, [camera]);

  const place = useCallback(
    (v: ViewState) => {
      camera.position.copy(v.target).add(offset(v.el, v.az));
      camera.up.set(0, 1, 0);
      camera.lookAt(v.target);
      camera.zoom = v.zoom;
      camera.near = 0.1;
      camera.far = RADIUS * 4;
      camera.updateProjectionMatrix();
      controlsRef.current?.target.copy(v.target);
    },
    [camera],
  );

  const animateTo = useCallback(
    (to: ViewState, dur = 650) => {
      if (prefersReducedMotion() || dur <= 0) {
        place(to);
        controlsRef.current?.update();
        return;
      }
      const from = current();
      anim.current = { t0: performance.now(), dur, from, to: { ...to, az: shortestAngle(from.az, to.az) } };
    },
    [current, place],
  );

  const isoView = useCallback((): ViewState => {
    const { target, zoom } = fitZoom(bounds, ISO_ELEVATION, ISO_AZIMUTH);
    return { el: ISO_ELEVATION, az: ISO_AZIMUTH, target, zoom };
  }, [bounds, fitZoom]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => animateTo(isoView()),
      focus: (box) => {
        const cur = current();
        const { target, zoom } = fitZoom(box, cur.el, cur.az, 0.35);
        animateTo({ el: cur.el, az: cur.az, target, zoom: Math.max(zoom, cur.zoom) });
      },
    }),
    [animateTo, isoView, current, fitZoom],
  );

  // First mount: start top-down, then glide to iso (800 ms).
  useEffect(() => {
    if (started.current || size.width === 0) return;
    started.current = true;
    const iso = isoView();
    if (prefersReducedMotion()) {
      place(iso);
      return;
    }
    const top = fitZoom(bounds, THREE.MathUtils.degToRad(89.9), ISO_AZIMUTH);
    place({ el: THREE.MathUtils.degToRad(89.9), az: ISO_AZIMUTH, target: top.target, zoom: top.zoom });
    anim.current = { t0: performance.now(), dur: 800, from: current(), to: iso };
  }, [size.width, bounds, isoView, fitZoom, place, current]);

  useFrame(() => {
    const controls = controlsRef.current;
    const a = anim.current;
    if (!a) {
      if (controls) {
        controls.enabled = !locked;
        controls.minPolarAngle = Math.PI / 2 - MAX_ELEVATION;
      }
      return;
    }
    if (controls) {
      controls.enabled = false;
      controls.minPolarAngle = 0; // allow the top-down intro
    }
    const t = Math.min(1, (performance.now() - a.t0) / a.dur);
    const k = ease(t);
    place({
      el: THREE.MathUtils.lerp(a.from.el, a.to.el, k),
      az: THREE.MathUtils.lerp(a.from.az, a.to.az, k),
      target: a.from.target.clone().lerp(a.to.target, k),
      zoom: THREE.MathUtils.lerp(a.from.zoom, a.to.zoom, k),
    });
    if (t >= 1) {
      anim.current = null;
      if (controls) {
        controls.minPolarAngle = Math.PI / 2 - MAX_ELEVATION;
        controls.enabled = !locked;
        controls.update();
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minPolarAngle={Math.PI / 2 - MAX_ELEVATION}
      maxPolarAngle={Math.PI / 2 - MIN_ELEVATION}
      minZoom={4}
      maxZoom={1200}
      zoomToCursor
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
});

export default IsoCamera;
