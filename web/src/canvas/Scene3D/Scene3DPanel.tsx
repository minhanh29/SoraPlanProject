// Stage scene_ready: the isometric 3D world with direct manipulation (docs/10 §2.5).
import { useCallback, useRef, useState } from "react";
import type { PanelProps } from "../panelTypes";
import type { Asset, ItemInstance, SceneOp } from "../../lib/types";
import { Spinner } from "../../components/ui";
import { useScene } from "../../hooks/useScene";
import { useAssetIndex } from "../../hooks/useAssets";
import { realDims } from "../../lib/furniture";
import SceneView from "./SceneView";
import Toolbar from "./Toolbar";
import ReplacePicker from "./ReplacePicker";
import AddPicker from "./AddPicker";
import type { CameraApi, Projection } from "./IsoCamera";
import type { OverlayImageStatus } from "./PlanOverlay";
import { freeSpot, pointInPolygon } from "./geometry";
import { useSceneColors } from "./useSceneColors";
import "./scene3d.css";

export default function Scene3DPanel({ project, files, onClose }: PanelProps) {
  const scene = useScene(project.id);
  const assets = useAssetIndex();
  const colors = useSceneColors();
  const cameraRef = useRef<CameraApi | null>(null);
  const [cutaway, setCutaway] = useState(true); // walls cut at 1 m so rooms are visible from the start
  const [projection, setProjection] = useState<Projection>("perspective");
  const [overlay, setOverlay] = useState(false);
  const [imageStatus, setImageStatus] = useState<OverlayImageStatus>("none");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<ItemInstance | null>(null);
  const [adding, setAdding] = useState(false);
  const { apply, graph } = scene;

  const surface = useCallback(
    (target: { allWalls: true } | { allFloors: true }, tint: string) =>
      apply([{ op: "surface.material", target, material: { tint } } as SceneOp], "allWalls" in target ? "Wall color" : "Floor color"),
    [apply],
  );

  /** Add at the center of the view (inside the home), on the nearest free spot. */
  const addAsset = useCallback(
    (asset: Asset) => {
      const level = graph?.levels[0];
      if (!graph || !level) return;
      const b = graph.meta.bounds;
      const t = cameraRef.current?.target();
      const start: [number, number] = [
        Math.min(b.maxX, Math.max(b.minX, t?.x ?? (b.minX + b.maxX) / 2)),
        Math.min(b.maxZ, Math.max(b.minZ, t?.z ?? (b.minZ + b.maxZ) / 2)),
      ];
      const dims = realDims(asset.dims, asset.category);
      const [x, z] = freeSpot({ rotationY: 0, dims }, start, level.items);
      const item: ItemInstance = {
        id: `itm_u_${Math.random().toString(36).slice(2, 10)}`,
        assetId: asset.id,
        componentId: null,
        label: asset.name,
        category: asset.category || null,
        roomId: level.rooms.find((r) => pointInPolygon(x, z, r.polygon))?.id ?? null,
        position: [x, 0, z],
        rotationY: 0,
        dims,
        scaleMode: "uniform",
        addedBy: "user",
      };
      apply([{ op: "item.add", item }], `Add ${asset.name}`);
      setSelectedId(item.id);
      setAdding(false);
    },
    [graph, apply],
  );

  if (scene.loading) {
    return (
      <div className="s3d-panel s3d-panel--empty">
        <Spinner size={20} /> <span className="muted">Loading 3D scene…</span>
      </div>
    );
  }
  if (!graph) {
    return (
      <div className="s3d-panel s3d-panel--empty">
        <Spinner size={20} /> <span className="muted">Building your 3D home…</span>
      </div>
    );
  }

  const units = project.floorPlan?.units === "ft" ? "ft" : "m";
  const itemCount = graph.levels[0]?.items.length ?? 0;
  const plan = project.floorPlan || null;

  return (
    <div className="s3d-panel">
      <SceneView
        graph={graph}
        assets={assets}
        units={units}
        colors={colors}
        cutaway={cutaway}
        projection={projection}
        cameraRef={cameraRef}
        selectedId={selectedId}
        onSelect={setSelectedId}
        overlay={overlay && plan ? { plan, imageUrl: files?.planUrl, onImageStatus: setImageStatus } : null}
        apply={apply}
        undo={scene.undo}
        redo={scene.redo}
        onRequestReplace={setReplacing}
      />
      <Toolbar
        wallColor={graph.meta.palette.wall}
        floorColor={graph.meta.palette.floor}
        cutaway={cutaway}
        perspective={projection === "perspective"}
        overlay={overlay}
        canOverlay={!!plan}
        canUndo={scene.canUndo}
        canRedo={scene.canRedo}
        onReset={() => cameraRef.current?.reset()}
        onTop={() => cameraRef.current?.top()}
        onToggleCutaway={() => setCutaway((c) => !c)}
        onToggleProjection={() => setProjection((p) => (p === "perspective" ? "orthographic" : "perspective"))}
        onToggleOverlay={() => {
          // Validation mode: walls cut low and a top-down view, so the plan is visible under everything
          if (!overlay) {
            setCutaway(true);
            cameraRef.current?.top();
          }
          setOverlay(!overlay);
        }}
        onAdd={() => setAdding(true)}
        onWallColor={(hex) => surface({ allWalls: true }, hex)}
        onFloorColor={(hex) => surface({ allFloors: true }, hex)}
        onUndo={scene.undo}
        onRedo={scene.redo}
        onClose={onClose}
      />
      <div className="s3d-hint" aria-hidden="true">
        <span className="pill">{graph.meta.style}</span>
        <span>{itemCount} items</span>
        {overlay && (
          <span className="s3d-hint__legend">
            <span className="s3d-hint__swatch" style={{ background: colors.parsed }} /> Parsed boxes
            <span className={imageStatus === "error" ? "s3d-hint__error" : undefined}>
              · Plan image{" "}
              {imageStatus === "loading" ? "loading…" : imageStatus === "error" ? "could not be loaded" : imageStatus === "none" ? "unavailable" : "shown"}
            </span>
          </span>
        )}
        <span className="s3d-hint__keys">
          Drag item to move · ring rotates · corners resize · R turn 90° · ⌘/Ctrl+D duplicate · Del delete · Pan: middle/right-drag, Space+drag or two-finger scroll · F frame
        </span>
      </div>
      <ReplacePicker
        item={replacing}
        assets={assets}
        style={graph.meta.style}
        onClose={() => setReplacing(null)}
        onPick={(a) => {
          if (replacing) apply([{ op: "item.replace", id: replacing.id, assetId: a.id }], `Replace ${replacing.label}`);
          setReplacing(null);
        }}
      />
      <AddPicker open={adding} assets={assets} style={graph.meta.style} onClose={() => setAdding(false)} onPick={addAsset} />
    </div>
  );
}
