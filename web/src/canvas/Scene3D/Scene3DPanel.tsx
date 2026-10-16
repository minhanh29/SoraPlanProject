// Stage scene_ready: the isometric 3D world with direct manipulation (docs/10 §2.5).
import { useCallback, useRef, useState } from "react";
import type { PanelProps } from "../panelTypes";
import type { ItemInstance, SceneOp } from "../../lib/types";
import { Spinner } from "../../components/ui";
import { useScene } from "../../hooks/useScene";
import { useAssetIndex } from "../../hooks/useAssets";
import SceneView from "./SceneView";
import Toolbar from "./Toolbar";
import ReplacePicker from "./ReplacePicker";
import type { CameraApi } from "./IsoCamera";
import { useSceneColors } from "./useSceneColors";
import "./scene3d.css";

export default function Scene3DPanel({ project, onClose }: PanelProps) {
  const scene = useScene(project.id);
  const assets = useAssetIndex();
  const colors = useSceneColors();
  const cameraRef = useRef<CameraApi | null>(null);
  const [cutaway, setCutaway] = useState(false);
  const [replacing, setReplacing] = useState<ItemInstance | null>(null);
  const { apply } = scene;

  const surface = useCallback(
    (target: { allWalls: true } | { allFloors: true }, tint: string) =>
      apply([{ op: "surface.material", target, material: { tint } } as SceneOp], "allWalls" in target ? "Wall color" : "Floor color"),
    [apply],
  );

  if (scene.loading) {
    return (
      <div className="s3d-panel s3d-panel--empty">
        <Spinner size={20} /> <span className="muted">Loading 3D scene…</span>
      </div>
    );
  }
  if (!scene.graph) {
    return (
      <div className="s3d-panel s3d-panel--empty">
        <Spinner size={20} /> <span className="muted">Building your 3D home…</span>
      </div>
    );
  }

  const graph = scene.graph;
  const units = project.floorPlan?.units === "ft" ? "ft" : "m";
  const itemCount = graph.levels[0]?.items.length ?? 0;

  return (
    <div className="s3d-panel">
      <SceneView
        graph={graph}
        assets={assets}
        units={units}
        colors={colors}
        cutaway={cutaway}
        cameraRef={cameraRef}
        apply={apply}
        undo={scene.undo}
        redo={scene.redo}
        onRequestReplace={setReplacing}
      />
      <Toolbar
        wallColor={graph.meta.palette.wall}
        floorColor={graph.meta.palette.floor}
        cutaway={cutaway}
        canUndo={scene.canUndo}
        canRedo={scene.canRedo}
        onReset={() => cameraRef.current?.reset()}
        onToggleCutaway={() => setCutaway((c) => !c)}
        onWallColor={(hex) => surface({ allWalls: true }, hex)}
        onFloorColor={(hex) => surface({ allFloors: true }, hex)}
        onUndo={scene.undo}
        onRedo={scene.redo}
        onClose={onClose}
      />
      <div className="s3d-hint" aria-hidden="true">
        <span className="pill">{graph.meta.style}</span>
        <span>{itemCount} items</span>
        <span className="s3d-hint__keys">Drag to move · ring to rotate · corners to resize · R rotate 90° · Del delete</span>
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
    </div>
  );
}
