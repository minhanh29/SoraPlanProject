// Camera rig: perspective (default, natural depth) or orthographic (parallel lines stay parallel; best for
// checking the plan overlay). Fits the scene bounds, animates between views (intro top-down → iso,
// Reset view, Top view, focus on an item) and clamps orbiting to 2°–89.9° elevation (down to eye level).
//
// A view is (elevation, azimuth, target, zoom) where zoom = CSS pixels per meter at the target, for both
// projections: orthographic uses it as camera.zoom, perspective turns it into a camera distance. Switching
// projection therefore keeps the framing.
//
// Navigation (same conventions as Figma / Blender / SketchUp):
//   orbit  left-drag · Alt + two-finger scroll
//   pan    middle-drag · right-drag (two-finger click-drag) · Space/Shift + left-drag · two-finger scroll
//   zoom   mouse wheel · pinch; in perspective, zooming in past FLY_DISTANCE moves forward instead of
//          stalling at the orbit target, so the camera can travel anywhere (into rooms, through doors)
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

export const ISO_ELEVATION = THREE.MathUtils.degToRad(35.26);
export const ISO_AZIMUTH = THREE.MathUtils.degToRad(45);
const MIN_ELEVATION = THREE.MathUtils.degToRad(2);
const TOP_ELEVATION = THREE.MathUtils.degToRad(89.9); // exactly 90° makes lookAt degenerate
const MAX_ELEVATION = TOP_ELEVATION;
const RADIUS = 80; // orthographic camera distance (any value outside the scene works)
export const FOV = 35; // perspective vertical field of view, degrees: natural, little wall lean in top view

export type Projection = "perspective" | "orthographic";
const ORBIT_PER_PX = 0.006;
/** Perspective: closer than this to the orbit target (m), zoom-in moves camera and target forward together. */
const FLY_DISTANCE = 1.2;
/** Meters moved per wheel pixel while flying (a mouse wheel notch is ~100 px). */
const FLY_PER_PX = 0.006;
const MIN_EYE_HEIGHT = 0.15;
const MAX_DISTANCE = 2000;

/** True while Space is held: left-drag pans instead of grabbing items. */
let spaceHeld = false;
export const isPanKeyHeld = () => spaceHeld;

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Trackpad two-finger scroll vs. mouse wheel (a trackpad pinch arrives as ctrl+wheel and is handled as zoom). */
function isTrackpad(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return false; // line/page deltas only come from wheels
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (legacy) return Math.abs(legacy + 3 * e.deltaY) < 3; // Chrome/Safari: trackpads report wheelDeltaY = -3·deltaY
  return e.deltaX !== 0 || !Number.isInteger(e.deltaY);
}

export interface Box3Like {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface CameraApi {
  /** Animate back to the isometric view fitted to the whole scene. */
  reset: () => void;
  /** Animate to a top-down plan view (plan's top edge up), fitted to the whole scene. */
  top: () => void;
  /** Animate to frame one box (e.g. an item on double-click). */
  focus: (box: Box3Like) => void;
  /** Move the view by a screen offset in CSS pixels (positive dy = look further down the screen). */
  pan: (dxPx: number, dyPx: number) => void;
  /** Current orbit target (the point at the center of the view). */
  target: () => THREE.Vector3;
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

function direction(el: number, az: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/** Perspective distance at which the target is drawn at `zoom` px per meter. */
function distanceFor(zoom: number, viewportHeight: number): number {
  return viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * Math.max(zoom, 1e-3));
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
  projection: Projection;
}

const IsoCamera = forwardRef<CameraApi, Props>(function IsoCamera({ bounds, locked, projection }, ref) {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera | THREE.PerspectiveCamera;
  const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const anim = useRef<Anim | null>(null);
  const started = useRef(false);
  /** Last placed/observed view, re-applied when the projection (camera object) changes. */
  const lastView = useRef<ViewState | null>(null);

  /** Zoom that frames `box` when viewed from (el, az). */
  const fitZoom = useCallback(
    (box: Box3Like, el: number, az: number, margin = 0.82) => {
      const target = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
      const probe = new THREE.Object3D();
      probe.position.copy(target).add(direction(el, az).multiplyScalar(RADIUS));
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
      // Perspective draws the near half of the box larger than the target plane: leave more room.
      return { target, zoom: Math.min(size.width / w, size.height / h) * margin * (perspective ? 0.85 : 1) };
    },
    [size.width, size.height, perspective],
  );

  const current = useCallback((): ViewState => {
    const target = controlsRef.current?.target.clone() ?? new THREE.Vector3();
    const off = camera.position.clone().sub(target);
    const len = Math.max(off.length(), 1e-6);
    const zoom = perspective ? size.height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * len) : camera.zoom;
    return { el: Math.asin(THREE.MathUtils.clamp(off.y / len, -1, 1)), az: Math.atan2(off.x, off.z), target, zoom };
  }, [camera, perspective, size.height]);

  const place = useCallback(
    (v: ViewState) => {
      const dist = perspective ? distanceFor(v.zoom, size.height) : RADIUS;
      camera.position.copy(v.target).add(direction(v.el, v.az).multiplyScalar(dist));
      camera.up.set(0, 1, 0);
      camera.lookAt(v.target);
      camera.zoom = perspective ? 1 : v.zoom;
      camera.near = perspective ? Math.max(0.02, dist / 400) : 0.1;
      camera.far = perspective ? dist + 500 : RADIUS * 4;
      camera.updateProjectionMatrix();
      controlsRef.current?.target.copy(v.target);
      lastView.current = { ...v, target: v.target.clone() };
    },
    [camera, perspective, size.height],
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

  const panBy = useCallback(
    (dxPx: number, dyPx: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      anim.current = null;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const zoom = current().zoom; // px per meter at the target, both projections
      const delta = right.multiplyScalar(dxPx / zoom).add(up.multiplyScalar(-dyPx / zoom));
      camera.position.add(delta);
      controls.target.add(delta);
      controls.update();
    },
    [camera, current],
  );

  const orbitBy = useCallback(
    (dxPx: number, dyPx: number) => {
      anim.current = null;
      const cur = current();
      place({
        ...cur,
        az: cur.az - dxPx * ORBIT_PER_PX,
        el: THREE.MathUtils.clamp(cur.el + dyPx * ORBIT_PER_PX, MIN_ELEVATION, MAX_ELEVATION),
      });
      controlsRef.current?.update();
    },
    [current, place],
  );

  useImperativeHandle(
    ref,
    () => ({
      reset: () => animateTo(isoView()),
      top: () => {
        const { target, zoom } = fitZoom(bounds, TOP_ELEVATION, 0);
        animateTo({ el: TOP_ELEVATION, az: 0, target, zoom });
      },
      focus: (box) => {
        const cur = current();
        const { target, zoom } = fitZoom(box, cur.el, cur.az, 0.35);
        animateTo({ el: cur.el, az: cur.az, target, zoom: Math.max(zoom, cur.zoom) });
      },
      pan: panBy,
      target: () => controlsRef.current?.target.clone() ?? new THREE.Vector3(),
    }),
    [animateTo, isoView, current, fitZoom, panBy, bounds],
  );

  // Two-finger trackpad scroll pans (Alt: orbits); the mouse wheel and pinch fall through to OrbitControls' zoom.
  // Registered in the capture phase on the canvas' parent, ahead of OrbitControls' own wheel listener.
  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement;
    let mode: "pan" | "zoom" = "zoom";
    let last = 0;
    const raycaster = new THREE.Raycaster();
    /** Close to the target, zoom-in flies toward the cursor; false lets OrbitControls dolly as usual. */
    const flyForward = (e: WheelEvent) => {
      const controls = controlsRef.current;
      if (!perspective || !controls || e.deltaY >= 0 || e.shiftKey || e.altKey) return false;
      if (camera.position.distanceTo(controls.target) > FLY_DISTANCE) return false;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const px = Math.min(-e.deltaY * (e.deltaMode === 1 ? 33 : 1) * (e.ctrlKey ? 4 : 1), 120); // pinch deltas are small
      const step = raycaster.ray.direction.multiplyScalar(px * FLY_PER_PX);
      // Stay above the floor: drop the downward part of the move at eye level
      if (camera.position.y + step.y < MIN_EYE_HEIGHT) step.y = Math.max(0, MIN_EYE_HEIGHT - camera.position.y);
      anim.current = null;
      camera.position.add(step);
      controls.target.add(step);
      controls.update();
      return true;
    };
    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey; // pinch / ctrl+wheel = zoom
      const now = performance.now();
      if (!pinch && now - last > 200) mode = isTrackpad(e) ? "pan" : "zoom"; // classify once per gesture
      if (!pinch) last = now;
      if ((pinch || mode === "zoom") && flyForward(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (pinch) return;
      if (mode !== "pan" && !e.shiftKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Shift+wheel on a mouse scrolls sideways in most apps: pan horizontally
      const dx = mode === "pan" ? e.deltaX : e.deltaY;
      const dy = mode === "pan" ? e.deltaY : 0;
      if (e.altKey) orbitBy(dx, dy);
      else panBy(dx, dy);
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [gl, panBy, orbitBy, camera, perspective]);

  // Hold Space to pan with the left button (and to drag "through" items).
  useEffect(() => {
    const setLeft = (pan: boolean) => {
      spaceHeld = pan;
      const c = controlsRef.current;
      if (c) c.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      gl.domElement.style.cursor = pan ? "grab" : "";
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping()) return;
      e.preventDefault(); // no page scroll / button click
      setLeft(true);
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setLeft(false);
    const blur = () => setLeft(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      setLeft(false);
    };
  }, [gl]);

  // Projection switched: the new camera takes over the last view (same framing).
  useEffect(() => {
    // A running animation (e.g. the intro, while drei's camera replaces R3F's default one) carries on by itself.
    if (!started.current || !lastView.current || anim.current) return;
    place(lastView.current);
    controlsRef.current?.update();
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  // First mount: start top-down, then glide to iso (800 ms).
  useEffect(() => {
    if (started.current || size.width === 0) return;
    started.current = true;
    const iso = isoView();
    if (prefersReducedMotion()) {
      place(iso);
      return;
    }
    const top = fitZoom(bounds, TOP_ELEVATION, ISO_AZIMUTH);
    place({ el: TOP_ELEVATION, az: ISO_AZIMUTH, target: top.target, zoom: top.zoom });
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
      if (started.current) lastView.current = current(); // follows user orbit/zoom/pan
      if (perspective) {
        // Keep the clip planes around the user's own dolly (near enough to fly through doors, far enough when zoomed out)
        const dist = camera.position.distanceTo(controls?.target ?? camera.position);
        const near = Math.max(0.02, dist / 400);
        const far = dist + 500;
        if (Math.abs(camera.near - near) > 1e-4 || Math.abs(camera.far - far) > 1) {
          camera.near = near;
          camera.far = far;
          camera.updateProjectionMatrix();
        }
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
    <>
      {projection === "perspective" ? (
        <PerspectiveCamera makeDefault fov={FOV} near={0.1} far={MAX_DISTANCE + 500} position={[30, 30, 30]} />
      ) : (
        <OrthographicCamera makeDefault zoom={40} near={0.1} far={RADIUS * 4} position={[40, 40, 40]} />
      )}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minPolarAngle={Math.PI / 2 - MAX_ELEVATION}
        maxPolarAngle={Math.PI / 2 - MIN_ELEVATION}
        minZoom={0.5}
        maxZoom={20000}
        minDistance={0.1}
        maxDistance={MAX_DISTANCE}
        zoomToCursor
        screenSpacePanning
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
});

export default IsoCamera;
