// The 3D viewport: isometric camera, lights, floors, walls, items and direct manipulation
// (select, drag-move on the floor, rotate ring, corner scale, keyboard shortcuts), plus the optional
// plan overlay used to validate the parse, the realistic render (post-processing, textured floors, glass)
// and the cinematic tour (camera driven by TourDirector, editing off, full walls, interior ceilings).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Html } from "@react-three/drei";
import * as THREE from "three";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import type { Asset, Dims, FloorPlan, ItemInstance, PlanUnits, SceneGraph, SceneOp, Vec3 } from "../../lib/types";
import { assetModelUrls } from "../../hooks/useAssets";
import { loadModel } from "../../three/loadModel";
import IsoCamera, { isPanKeyHeld, type CameraApi, type Projection } from "./IsoCamera";
import Walls from "./Walls";
import Floors from "./Floors";
import { ItemView } from "./Items";
import Gizmo, { ringRadius } from "./Gizmo";
import { worldPerPixel } from "./cameraScale";
import PlanOverlay, { type OverlayImageStatus } from "./PlanOverlay";
import RealisticEffects from "./RealisticEffects";
import Interior from "./Interior";
import TourDirector, { type TourApi } from "./TourDirector";
import type { Tour, TourFrame } from "./cinematic";
import SelectionChip from "./SelectionChip";
import {
  clamp,
  freeSpot,
  itemAxes,
  nearestWallGap,
  normalizeAngle,
  overlappingIds,
  SCALE_MAX,
  SCALE_MIN,
  snap,
  snapAngle,
} from "./geometry";
import type { SceneColors } from "./useSceneColors";

export interface SceneViewProps {
  graph: SceneGraph;
  assets: Record<string, Asset>;
  units: PlanUnits;
  colors: SceneColors;
  cutaway: boolean;
  projection: Projection;
  cameraRef: MutableRefObject<CameraApi | null>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Plan image + parsed boxes drawn on the floor (validation), or null when off. */
  overlay: { plan: FloorPlan; imageUrl: string | null | undefined; onImageStatus: (s: OverlayImageStatus) => void } | null;
  apply: (ops: SceneOp[], label?: string) => void;
  undo: () => void;
  redo: () => void;
  onRequestReplace: (item: ItemInstance) => void;
  /** Realistic render (always on during the tour). */
  realistic: boolean;
  /** Cinematic tour in progress (camera driven, editing off), or null. */
  tour: TourSetup | null;
  /** Canvas pixel ratio and frame loop: the video export renders at its own resolution, frame by frame. */
  renderDpr?: number;
  frameloop?: "always" | "never";
}

export interface TourSetup {
  plan: Tour;
  playing: boolean;
  timeRef: MutableRefObject<number>;
  apiRef: MutableRefObject<TourApi | null>;
  onFrame: (f: TourFrame) => void;
  onEnd: () => void;
}

type Preview = { id: string; position?: Vec3; rotationY?: number; dims?: Dims };

type Drag =
  | { mode: "pending" | "move"; id: string; startX: number; startY: number; offset: [number, number] }
  | { mode: "rotate"; id: string; center: [number, number]; startAngle: number; startRot: number }
  | { mode: "scale"; id: string; center: [number, number]; rot: number; startDims: Dims }
  /** Side handle: the opposite side (`fixed`, floor coords) stays put while the dragged side follows the pointer. */
  | { mode: "edge"; id: string; axis: "w" | "d"; sign: 1 | -1; rot: number; fixed: [number, number]; y: number; startDims: Dims }
  /** Height handle: vertical screen motion → meters (scale at the item, corrected for camera tilt). */
  | { mode: "height"; id: string; startY: number; metersPerPx: number; startDims: Dims };

const MIN_SIDE = 0.05; // m
const MAX_SIDE = 12;
const MAX_HEIGHT = 4;

const CUTAWAY_HEIGHT = 1;
const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};
const round = (v: number, step = 0.01) => Math.round(v / step) * step;
const noop = () => undefined;
const mm = (v: number) => Math.round(v * 1000) / 1000; // no float noise in stored positions
const PAN_STEP_PX = 80;

/**
 * Group placed at the item's top edge *on screen* (highest projected point of its bbox top and rotate ring),
 * horizontally centered on the item, so an <Html> label inside it, lifted by its own height, never covers it.
 * Works in screen space, so it holds for perspective and orthographic cameras alike.
 */
function AboveItem({ item, children }: { item: ItemInstance; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    const { ax, az } = itemAxes(item.rotationY);
    const [px, , pz] = item.position;
    const { w, d, h } = item.dims;
    let top = -Infinity;
    const consider = (x: number, y: number, z: number) => {
      top = Math.max(top, v.set(x, y, z).project(camera).y);
    };
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) consider(px + (ax[0] * w * sx + az[0] * d * sz) / 2, h, pz + (ax[1] * w * sx + az[1] * d * sz) / 2);
    const r = ringRadius(item.dims);
    for (let i = 0; i < 16; i++) consider(px + r * Math.cos((i * Math.PI) / 8), 0.02, pz + r * Math.sin((i * Math.PI) / 8));
    const center = v.set(px, h, pz).project(camera); // NDC of the top center
    g.position.copy(center.setY(top).unproject(camera));
  });
  return <group ref={ref}>{children}</group>;
}

function SceneContents(props: SceneViewProps & { missedRef: MutableRefObject<(() => void) | null> }) {
  const { graph, assets, units, colors, cutaway, cameraRef, apply, undo, redo, onRequestReplace, missedRef } = props;
  const { selectedId: rawSelectedId, onSelect: setSelectedId, overlay: rawOverlay, projection, tour } = props;
  const touring = !!tour;
  const realistic = props.realistic || touring;
  // The tour shows the finished home: no selection, overlays or cutaway
  const selectedId = touring ? null : rawSelectedId;
  const overlay = touring ? null : rawOverlay;
  const wallsCut = cutaway && !touring;
  const interiorRef = useRef(false);
  const composerRef = useRef<EffectComposerImpl | null>(null);
  const level = graph.levels[0];
  const { camera, gl } = useThree();
  const size = useThree((s) => s.size);
  const controls = useThree((st) => st.controls) as { enabled: boolean } | null;
  /** Stop OrbitControls at once (IsoCamera re-enables it when the drag ends). */
  const holdControls = useCallback(() => {
    if (controls) controls.enabled = false;
  }, [controls]);
  const [preview, setPreviewState] = useState<Preview | null>(null);
  const [dragMode, setDragMode] = useState<Drag["mode"] | null>(null);
  const [loadModels, setLoadModels] = useState(false);
  const drag = useRef<Drag | null>(null);
  const previewRef = useRef<Preview | null>(null);
  /** The ref is updated at once: a pointerup right after the last move must commit that move, not the one before. */
  const setPreview = useCallback((p: Preview | null) => {
    previewRef.current = p;
    setPreviewState(p);
  }, []);

  // Lazy-load GLBs once the walls have painted.
  useEffect(() => {
    let a = 0;
    const b = requestAnimationFrame(() => (a = requestAnimationFrame(() => setLoadModels(true))));
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, []);

  const bounds = useMemo(() => {
    const b = graph.meta.bounds;
    return {
      min: new THREE.Vector3(b.minX, 0, b.minZ),
      max: new THREE.Vector3(b.maxX, cutaway ? CUTAWAY_HEIGHT : level?.ceilingHeight || 2.7, b.maxZ),
    };
  }, [graph.meta.bounds, level?.ceilingHeight, cutaway]);

  const items = useMemo(
    () =>
      (level?.items || []).map((it) =>
        preview && preview.id === it.id
          ? {
              ...it,
              position: preview.position ?? it.position,
              rotationY: preview.rotationY ?? it.rotationY,
              dims: preview.dims ?? it.dims,
            }
          : it,
      ),
    [level?.items, preview],
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const overlaps = useMemo(() => overlappingIds(items), [items]);
  const selected = items.find((i) => i.id === selectedId) || null;

  // Selection disappears when the item does (undo, AI removal).
  useEffect(() => {
    if (selectedId && !level?.items.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [level?.items, selectedId, setSelectedId]);

  // ---------------------------------------------------------------- ray helpers
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const hitPlane = useCallback(
    (clientX: number, clientY: number, y = 0): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const out = new THREE.Vector3();
      return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out);
    },
    [camera, gl, raycaster],
  );
  /** Angle convention matching rotationY: rotating +X by r points to (cos r, -sin r). */
  const angleOf = (x: number, z: number, c: [number, number]) => Math.atan2(-(z - c[1]), x - c[0]);

  // ---------------------------------------------------------------- drag lifecycle
  const endDrag = useCallback(() => {
    const d = drag.current;
    const p = previewRef.current;
    drag.current = null;
    setDragMode(null);
    document.body.style.cursor = "";
    if (!d || !p) {
      setPreview(null);
      return;
    }
    const orig = itemsRef.current.find((i) => i.id === d.id);
    const base = graph.levels[0]?.items.find((i) => i.id === d.id) || orig;
    const ops: SceneOp[] = [];
    if (base && p.position && (p.position[0] !== base.position[0] || p.position[2] !== base.position[2]))
      ops.push({ op: "item.move", id: d.id, position: p.position });
    if (base && p.rotationY !== undefined && p.rotationY !== base.rotationY)
      ops.push({ op: "item.rotate", id: d.id, rotationY: p.rotationY });
    if (base && p.dims && (p.dims.w !== base.dims.w || p.dims.d !== base.dims.d || p.dims.h !== base.dims.h))
      ops.push({ op: "item.resize", id: d.id, dims: p.dims });
    const label = d.mode === "rotate" ? "Rotate" : d.mode === "move" || d.mode === "pending" ? "Move" : "Resize";
    if (ops.length) apply(ops, `${label} ${base?.label || "item"}`);
    setPreview(null);
  }, [apply, graph]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const item = itemsRef.current.find((i) => i.id === d.id);
      if (!item) return;
      if (d.mode === "pending") {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        drag.current = { ...d, mode: "move" };
        setDragMode("move");
        document.body.style.cursor = "grabbing";
      }
      const cur = drag.current!;
      if (cur.mode === "move") {
        const hit = hitPlane(e.clientX, e.clientY);
        if (!hit) return;
        setPreview({ id: cur.id, position: [snap(hit.x + cur.offset[0]), item.position[1], snap(hit.z + cur.offset[1])] });
      } else if (cur.mode === "rotate") {
        const hit = hitPlane(e.clientX, e.clientY);
        if (!hit) return;
        const raw = cur.startRot + (angleOf(hit.x, hit.z, cur.center) - cur.startAngle);
        setPreview({ id: cur.id, rotationY: e.altKey ? normalizeAngle(raw) : snapAngle(raw) });
      } else if (cur.mode === "scale") {
        const hit = hitPlane(e.clientX, e.clientY, cur.startDims.h);
        if (!hit) return;
        const { ax, az } = itemAxes(cur.rot);
        const dx = hit.x - cur.center[0];
        const dz = hit.z - cur.center[1];
        const lx = Math.abs(dx * ax[0] + dz * ax[1]);
        const lz = Math.abs(dx * az[0] + dz * az[1]);
        const s0 = cur.startDims;
        let dims: Dims;
        if (e.shiftKey) {
          dims = {
            w: round(clamp(2 * lx, s0.w * SCALE_MIN, s0.w * SCALE_MAX)),
            d: round(clamp(2 * lz, s0.d * SCALE_MIN, s0.d * SCALE_MAX)),
            h: s0.h,
          };
        } else {
          const f = clamp(Math.hypot(lx, lz) / Math.max(Math.hypot(s0.w / 2, s0.d / 2), 1e-3), SCALE_MIN, SCALE_MAX);
          dims = { w: round(s0.w * f), d: round(s0.d * f), h: round(s0.h * f) };
        }
        setPreview({ id: cur.id, dims });
      } else if (cur.mode === "edge") {
        const hit = hitPlane(e.clientX, e.clientY, cur.y);
        if (!hit) return;
        const { ax, az } = itemAxes(cur.rot);
        const [dx, dz] = cur.axis === "w" ? ax : az;
        const ux = dx * cur.sign; // unit vector from the fixed side toward the dragged side
        const uz = dz * cur.sign;
        const len = round(clamp((hit.x - cur.fixed[0]) * ux + (hit.z - cur.fixed[1]) * uz, MIN_SIDE, MAX_SIDE), 0.005);
        setPreview({
          id: cur.id,
          dims: { ...cur.startDims, [cur.axis]: len },
          position: [mm(cur.fixed[0] + (ux * len) / 2), item.position[1], mm(cur.fixed[1] + (uz * len) / 2)],
        });
      } else if (cur.mode === "height") {
        const h = round(clamp(cur.startDims.h + (cur.startY - e.clientY) * cur.metersPerPx, MIN_SIDE, MAX_HEIGHT), 0.005);
        setPreview({ id: cur.id, dims: { ...cur.startDims, h } });
      }
    },
    [hitPlane],
  );

  useEffect(() => {
    missedRef.current = () => !drag.current && setSelectedId(null);
  }, [missedRef, setSelectedId]);

  useEffect(() => {
    const up = () => drag.current && endDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onMove, endDrag]);

  const onItemDown = useCallback(
    (item: ItemInstance, e: ThreeEvent<PointerEvent>) => {
      if (touring || e.button !== 0 || isPanKeyHeld()) return; // middle/right-drag and Space+drag pan the view
      e.stopPropagation();
      holdControls();
      setSelectedId(item.id);
      const hit = hitPlane(e.nativeEvent.clientX, e.nativeEvent.clientY);
      drag.current = {
        mode: "pending",
        id: item.id,
        startX: e.nativeEvent.clientX,
        startY: e.nativeEvent.clientY,
        offset: hit ? [item.position[0] - hit.x, item.position[2] - hit.z] : [0, 0],
      };
      setDragMode("pending");
    },
    [hitPlane, holdControls, setSelectedId, touring],
  );

  const onRotateStart = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!selected) return;
      const hit = hitPlane(e.nativeEvent.clientX, e.nativeEvent.clientY);
      if (!hit) return;
      holdControls();
      const center: [number, number] = [selected.position[0], selected.position[2]];
      drag.current = { mode: "rotate", id: selected.id, center, startAngle: angleOf(hit.x, hit.z, center), startRot: selected.rotationY };
      setDragMode("rotate");
      document.body.style.cursor = "grabbing";
    },
    [selected, hitPlane, holdControls],
  );

  const onScaleStart = useCallback(() => {
    if (!selected) return;
    holdControls();
    drag.current = {
      mode: "scale",
      id: selected.id,
      center: [selected.position[0], selected.position[2]],
      rot: selected.rotationY,
      startDims: { ...selected.dims },
    };
    setDragMode("scale");
  }, [selected, holdControls]);

  const onEdgeStart = useCallback(
    (axis: "w" | "d", sign: 1 | -1) => {
      if (!selected) return;
      holdControls();
      const { ax, az } = itemAxes(selected.rotationY);
      const [dx, dz] = axis === "w" ? ax : az;
      const half = selected.dims[axis] / 2;
      drag.current = {
        mode: "edge",
        id: selected.id,
        axis,
        sign,
        rot: selected.rotationY,
        fixed: [selected.position[0] - dx * sign * half, selected.position[2] - dz * sign * half],
        y: selected.dims.h, // the handles sit on the top face
        startDims: { ...selected.dims },
      };
      setDragMode("edge");
    },
    [selected, holdControls],
  );

  const onHeightStart = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!selected) return;
      holdControls();
      const top = new THREE.Vector3(selected.position[0], selected.dims.h, selected.position[2]);
      const look = new THREE.Vector3();
      camera.getWorldDirection(look);
      // A vertical segment of h meters shows as h·cos(elevation) on screen; near top-down, cap the gain
      const cosEl = Math.max(Math.hypot(look.x, look.z), 0.35);
      drag.current = {
        mode: "height",
        id: selected.id,
        startY: e.nativeEvent.clientY,
        metersPerPx: worldPerPixel(camera, top, size.height) / cosEl,
        startDims: { ...selected.dims },
      };
      setDragMode("height");
    },
    [selected, holdControls, camera, size.height],
  );

  const focusItem = useCallback(
    (item: ItemInstance) => {
      setSelectedId(item.id);
      const r = Math.hypot(item.dims.w, item.dims.d) / 2;
      cameraRef.current?.focus({
        min: new THREE.Vector3(item.position[0] - r, 0, item.position[2] - r),
        max: new THREE.Vector3(item.position[0] + r, item.dims.h, item.position[2] + r),
      });
    },
    [cameraRef, setSelectedId],
  );

  const removeItem = useCallback(
    (item: ItemInstance) => {
      apply([{ op: "item.remove", id: item.id }], `Delete ${item.label}`);
      setSelectedId(null);
    },
    [apply, setSelectedId],
  );

  const duplicateItem = useCallback(
    (item: ItemInstance) => {
      const others = itemsRef.current;
      const [x, z] = freeSpot(item, [item.position[0] + item.dims.w / 2 + 0.3, item.position[2]], others);
      const copy: ItemInstance = {
        ...structuredClone(item),
        id: `itm_u_${Math.random().toString(36).slice(2, 10)}`,
        componentId: null,
        position: [x, item.position[1], z],
        addedBy: "user",
      };
      apply([{ op: "item.add", item: copy }], `Duplicate ${item.label}`);
      setSelectedId(copy.id);
    },
    [apply, setSelectedId],
  );

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || touring) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      const item = itemsRef.current.find((i) => i.id === selectedId);
      if (drag.current) return;
      if (e.key.toLowerCase() === "f" && !mod) {
        e.preventDefault();
        if (item) focusItem(item);
        else cameraRef.current?.reset();
        return;
      }
      if (!item) {
        // Nothing selected: arrows pan the view
        const pan: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const dir = pan[e.key];
        if (dir) {
          e.preventDefault();
          const step = e.shiftKey ? PAN_STEP_PX * 3 : PAN_STEP_PX;
          cameraRef.current?.pan(dir[0] * step, dir[1] * step);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateItem(item);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeItem(item);
      } else if (e.key.toLowerCase() === "r" && !mod) {
        e.preventDefault();
        apply([{ op: "item.rotate", id: item.id, rotationY: snapAngle(item.rotationY + Math.PI / 2) }], `Rotate ${item.label}`);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.05;
        // Camera-relative nudges, snapped to the closest world axis.
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const look = new THREE.Vector3();
        camera.getWorldDirection(look); // "up" on screen = away from the camera on the floor
        const axis = (v: THREE.Vector3): [number, number] =>
          Math.abs(v.x) >= Math.abs(v.z) ? [Math.sign(v.x), 0] : [0, Math.sign(v.z)];
        const dir =
          e.key === "ArrowRight" ? axis(right) : e.key === "ArrowLeft" ? axis(right.negate()) : e.key === "ArrowUp" ? axis(look) : axis(look.negate());
        const position: Vec3 = [snap(item.position[0] + dir[0] * step), item.position[1], snap(item.position[2] + dir[1] * step)];
        apply([{ op: "item.move", id: item.id, position }], `Move ${item.label}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, setSelectedId, apply, undo, redo, removeItem, duplicateItem, focusItem, cameraRef, camera, touring]);

  /** Every item's GLB loaded (the video must not show placeholder boxes). */
  const preloadModels = useCallback(async () => {
    setLoadModels(true);
    const urls = (level?.items || []).flatMap((it) => {
      const a = it.assetId ? assets[it.assetId] : undefined;
      return a?.status === "ready" ? [assetModelUrls(a)] : [];
    });
    await Promise.allSettled(urls.map((u) => loadModel(u)));
  }, [level?.items, assets]);

  // ---------------------------------------------------------------- render
  const center = useMemo(() => bounds.min.clone().add(bounds.max).multiplyScalar(0.5), [bounds]);
  const extent = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 4);
  const lightTarget = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    lightTarget.position.set(center.x, 0, center.z);
    lightTarget.updateMatrixWorld();
  }, [center, lightTarget]);

  const selectedWarning = selected && overlaps.has(selected.id) ? "Overlaps another item" : null;
  const wallGap = selected && dragMode === "move" ? nearestWallGap(selected, level?.walls || [])?.gap ?? null : null;
  const selectedAsset = selected?.assetId ? assets[selected.assetId] : undefined;

  return (
    <>
      <color attach="background" args={[colors.background]} />
      <IsoCamera ref={cameraRef} bounds={bounds} locked={dragMode !== null || touring} projection={touring ? "perspective" : projection} />
      {/* Realistic: warmer, stronger sun and less flat fill, so form comes from light and AO */}
      <hemisphereLight args={["#ffffff", "#b9b2a6", realistic ? 0.25 : 0.75]} />
      <ambientLight intensity={realistic ? 0.04 : 0.25} />
      <primitive object={lightTarget} />
      <directionalLight
        position={[center.x - extent * 0.45, extent * 1.1, center.z + extent * 0.7]}
        target={lightTarget}
        color={realistic ? "#fff1dc" : "#ffffff"}
        intensity={realistic ? 3 : 1.9}
        castShadow
        // Fixed size: three.js keeps the shadow map it allocated first, so a runtime change would not apply
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={0.5}
        shadow-camera-far={extent * 4}
      />
      <Suspense fallback={null}>
        <Environment preset="apartment" environmentIntensity={realistic ? 0.35 : 0.45} />
      </Suspense>
      {realistic && <RealisticEffects ref={composerRef} high={props.frameloop === "never"} />}
      {touring && <Interior rooms={level?.rooms || []} height={level?.ceilingHeight || 2.7} interiorRef={interiorRef} />}
      {tour && (
        <TourDirector
          ref={tour.apiRef}
          tour={tour.plan}
          playing={tour.playing}
          timeRef={tour.timeRef}
          interiorRef={interiorRef}
          composerRef={composerRef}
          preload={preloadModels}
          onFrame={tour.onFrame}
          onEnd={tour.onEnd}
        />
      )}

      <Floors bounds={graph.meta.bounds} rooms={level?.rooms || []} palette={graph.meta.palette} realistic={realistic} />
      <Walls
        walls={level?.walls || []}
        openings={level?.openings || []}
        palette={graph.meta.palette}
        cutHeight={wallsCut ? CUTAWAY_HEIGHT : null}
        realistic={realistic}
      />
      <ContactShadows position={[center.x, 0.004, center.z]} scale={extent * 1.6} opacity={0.32} blur={2.2} far={2.5} resolution={1024} />
      {overlay && <PlanOverlay plan={overlay.plan} imageUrl={overlay.imageUrl} color={colors.parsed} onImageStatus={overlay.onImageStatus} />}

      {items.map((it) => (
        <ItemView
          key={it.id}
          item={it}
          asset={it.assetId ? assets[it.assetId] : undefined}
          loadModels={loadModels}
          accent={graph.meta.palette.accent}
          showLabel={!touring}
          onPointerDown={onItemDown}
          onDoubleClick={focusItem}
        />
      ))}

      {/* Overlap warnings stay on dropped items */}
      {items
        .filter((it) => !touring && overlaps.has(it.id) && it.id !== selectedId)
        .map((it) => (
          <Gizmo key={`w-${it.id}`} item={it} color={colors.danger} warnColor={colors.danger} warning showHandles={false} onRotateStart={noop} onScaleStart={noop} onEdgeStart={noop} onHeightStart={noop} />
        ))}

      {selected && (
        <>
          <Gizmo
            item={selected}
            color={colors.select}
            warnColor={colors.danger}
            warning={overlaps.has(selected.id)}
            showHandles={dragMode !== "move"}
            onRotateStart={onRotateStart}
            onScaleStart={onScaleStart}
            onEdgeStart={onEdgeStart}
            onHeightStart={onHeightStart}
          />
          <AboveItem item={selected}>
            <Html zIndexRange={[30, 10]}>
              <div className="s3d-anchor">
                <SelectionChip
                  item={selected}
                  name={selected.label || selectedAsset?.name || "Item"}
                  units={units}
                  warning={selectedWarning}
                  wallGap={wallGap}
                  dragging={dragMode !== null && dragMode !== "pending"}
                  resizing={dragMode === "scale" || dragMode === "edge" || dragMode === "height"}
                  onReplace={() => onRequestReplace(selected)}
                  onDelete={() => removeItem(selected)}
                />
              </div>
            </Html>
          </AboveItem>
        </>
      )}
    </>
  );
}

export default function SceneView(props: SceneViewProps) {
  const missedRef = useRef<(() => void) | null>(null);
  return (
    <Canvas
      onPointerMissed={() => missedRef.current?.()}
      shadows="soft"
      dpr={props.renderDpr ?? [1, 2]}
      frameloop={props.frameloop ?? "always"}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: false }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "none" }}
    >
      <SceneContents {...props} missedRef={missedRef} />
    </Canvas>
  );
}
