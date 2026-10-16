// The 3D viewport: isometric camera, lights, floors, walls, items and direct manipulation
// (select, drag-move on the floor, rotate ring, corner scale, keyboard shortcuts).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Html } from "@react-three/drei";
import * as THREE from "three";
import type { Asset, Dims, ItemInstance, PlanUnits, SceneGraph, SceneOp, Vec3 } from "../../lib/types";
import IsoCamera, { type CameraApi } from "./IsoCamera";
import Walls from "./Walls";
import Floors from "./Floors";
import { ItemView } from "./Items";
import Gizmo from "./Gizmo";
import SelectionChip from "./SelectionChip";
import {
  clamp,
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
  cameraRef: MutableRefObject<CameraApi | null>;
  apply: (ops: SceneOp[], label?: string) => void;
  undo: () => void;
  redo: () => void;
  onRequestReplace: (item: ItemInstance) => void;
}

type Preview = { id: string; position?: Vec3; rotationY?: number; dims?: Dims };

type Drag =
  | { mode: "pending" | "move"; id: string; startX: number; startY: number; offset: [number, number] }
  | { mode: "rotate"; id: string; center: [number, number]; startAngle: number; startRot: number }
  | { mode: "scale"; id: string; center: [number, number]; rot: number; startDims: Dims };

const CUTAWAY_HEIGHT = 1;
const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};
const round = (v: number, step = 0.01) => Math.round(v / step) * step;

function SceneContents(props: SceneViewProps & { missedRef: MutableRefObject<(() => void) | null> }) {
  const { graph, assets, units, colors, cutaway, cameraRef, apply, undo, redo, onRequestReplace, missedRef } = props;
  const level = graph.levels[0];
  const { camera, gl } = useThree();
  const controls = useThree((st) => st.controls) as { enabled: boolean } | null;
  /** Stop OrbitControls at once (IsoCamera re-enables it when the drag ends). */
  const holdControls = useCallback(() => {
    if (controls) controls.enabled = false;
  }, [controls]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragMode, setDragMode] = useState<Drag["mode"] | null>(null);
  const [loadModels, setLoadModels] = useState(false);
  const drag = useRef<Drag | null>(null);
  const previewRef = useRef<Preview | null>(null);
  previewRef.current = preview;

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
  }, [level?.items, selectedId]);

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
    const label = d.mode === "rotate" ? "Rotate" : d.mode === "scale" ? "Resize" : "Move";
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
      }
    },
    [hitPlane],
  );

  useEffect(() => {
    missedRef.current = () => !drag.current && setSelectedId(null);
  }, [missedRef]);

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
      if (e.button !== 0) return; // right-drag pans
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
    [hitPlane, holdControls],
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

  const focusItem = useCallback(
    (item: ItemInstance) => {
      setSelectedId(item.id);
      const r = Math.hypot(item.dims.w, item.dims.d) / 2;
      cameraRef.current?.focus({
        min: new THREE.Vector3(item.position[0] - r, 0, item.position[2] - r),
        max: new THREE.Vector3(item.position[0] + r, item.dims.h, item.position[2] + r),
      });
    },
    [cameraRef],
  );

  const removeItem = useCallback(
    (item: ItemInstance) => {
      apply([{ op: "item.remove", id: item.id }], `Delete ${item.label}`);
      setSelectedId(null);
    },
    [apply],
  );

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
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
      if (!item || drag.current) return;
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
  }, [selectedId, apply, undo, redo, removeItem, camera]);

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
      <IsoCamera ref={cameraRef} bounds={bounds} locked={dragMode !== null} />
      <hemisphereLight args={["#ffffff", "#b9b2a6", 0.75]} />
      <ambientLight intensity={0.25} />
      <primitive object={lightTarget} />
      <directionalLight
        position={[center.x - extent * 0.45, extent * 1.1, center.z + extent * 0.7]}
        target={lightTarget}
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
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
        <Environment preset="apartment" environmentIntensity={0.45} />
      </Suspense>

      <Floors bounds={graph.meta.bounds} rooms={level?.rooms || []} palette={graph.meta.palette} />
      <Walls walls={level?.walls || []} openings={level?.openings || []} palette={graph.meta.palette} cutHeight={cutaway ? CUTAWAY_HEIGHT : null} />
      <ContactShadows position={[center.x, 0.004, center.z]} scale={extent * 1.6} opacity={0.32} blur={2.2} far={2.5} resolution={1024} />

      {items.map((it) => (
        <ItemView
          key={it.id}
          item={it}
          asset={it.assetId ? assets[it.assetId] : undefined}
          loadModels={loadModels}
          accent={graph.meta.palette.accent}
          onPointerDown={onItemDown}
          onDoubleClick={focusItem}
        />
      ))}

      {/* Overlap warnings stay on dropped items */}
      {items
        .filter((it) => overlaps.has(it.id) && it.id !== selectedId)
        .map((it) => (
          <Gizmo key={`w-${it.id}`} item={it} color={colors.danger} warnColor={colors.danger} warning showHandles={false} onRotateStart={() => undefined} onScaleStart={() => undefined} />
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
          />
          <Html position={[selected.position[0], selected.dims.h + 0.12, selected.position[2]]} center zIndexRange={[30, 10]}>
            <SelectionChip
              item={selected}
              name={selected.label || selectedAsset?.name || "Item"}
              units={units}
              warning={selectedWarning}
              wallGap={wallGap}
              dragging={dragMode === "move" || dragMode === "rotate" || dragMode === "scale"}
              onReplace={() => onRequestReplace(selected)}
              onDelete={() => removeItem(selected)}
            />
          </Html>
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
      orthographic
      shadows="soft"
      dpr={[1, 2]}
      camera={{ position: [40, 40, 40], zoom: 40, near: 0.1, far: 400 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: false }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "none" }}
    >
      <SceneContents {...props} missedRef={missedRef} />
    </Canvas>
  );
}
