// Stage scene_ready: the isometric 3D world with direct manipulation (docs/10 §2.5), the realistic render and
// the cinematic tour (preview + MP4 export).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelProps } from "../panelTypes";
import type { Asset, ItemInstance, SceneOp } from "../../lib/types";
import { Icon, Spinner, toast } from "../../components/ui";
import { useScene } from "../../hooks/useScene";
import { useAssetIndex } from "../../hooks/useAssets";
import { realDims } from "../../lib/furniture";
import { cssVar } from "../../lib/theme";
import SceneView, { type TourSetup } from "./SceneView";
import Toolbar from "./Toolbar";
import ReplacePicker from "./ReplacePicker";
import AddPicker from "./AddPicker";
import TourBar from "./TourBar";
import TourOverlay, { type TourOverlayApi } from "./TourOverlay";
import type { TourApi } from "./TourDirector";
import type { CameraApi, Projection } from "./IsoCamera";
import type { OverlayImageStatus } from "./PlanOverlay";
import { planTour } from "./cinematic";
import { canExportVideo, downloadBlob } from "./exportVideo";
import { freeSpot, pointInPolygon } from "./geometry";
import { useSceneColors } from "./useSceneColors";
import "./scene3d.css";

const REALISTIC_KEY = "soraplan.realistic";
const EXPORT_FPS = 30;

const readRealistic = () => {
  try {
    return localStorage.getItem(REALISTIC_KEY) === "1";
  } catch {
    return false;
  }
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
const nextFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

export default function Scene3DPanel({ project, files, onClose }: PanelProps) {
  const scene = useScene(project.id);
  const assets = useAssetIndex();
  const colors = useSceneColors();
  const cameraRef = useRef<CameraApi | null>(null);
  const [cutaway, setCutaway] = useState(true); // walls cut at 1 m so rooms are visible from the start
  const [projection, setProjection] = useState<Projection>("perspective");
  const [realistic, setRealistic] = useState(readRealistic);
  const [overlay, setOverlay] = useState(false);
  const [imageStatus, setImageStatus] = useState<OverlayImageStatus>("none");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<ItemInstance | null>(null);
  const [adding, setAdding] = useState(false);
  const { apply, graph } = scene;

  // ---------------------------------------------------------------- tour
  const [touring, setTouring] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exportState, setExportState] = useState<{ dpr: number; progress: number } | null>(null);
  const tourTime = useRef(0);
  const tourApi = useRef<TourApi | null>(null);
  const overlayApi = useRef<TourOverlayApi | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const style = graph?.meta.style;
  const tourPlan = useMemo(
    () => (touring && graph ? planTour(graph, { title: project.name || "Your home", subtitle: style ? `${style} home` : undefined }) : null),
    // Planned once per tour: edits made while touring (by the assistant) show up in the next tour
    [touring], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onTourFrame = useCallback((f: Parameters<TourOverlayApi["update"]>[0]) => overlayApi.current?.update(f), []);
  const onTourEnd = useCallback(() => setPlaying(false), []);
  const tourSetup: TourSetup | null = useMemo(
    () =>
      tourPlan
        ? { plan: tourPlan, playing, timeRef: tourTime, apiRef: tourApi, onFrame: onTourFrame, onEnd: onTourEnd }
        : null,
    [tourPlan, playing, onTourFrame, onTourEnd],
  );

  const startTour = () => {
    setSelectedId(null);
    setOverlay(false);
    tourTime.current = 0;
    setTouring(true);
    setPlaying(true);
  };
  const exitTour = () => {
    abortRef.current?.abort();
    setPlaying(false);
    setTouring(false);
  };
  // Back to the usual view once the tour camera is gone
  const wasTouring = useRef(false);
  useEffect(() => {
    if (wasTouring.current && !touring) cameraRef.current?.reset();
    wasTouring.current = touring;
  }, [touring]);

  const exportVideo = async (height: 1080 | 720) => {
    const stage = stageRef.current;
    if (!stage || !tourApi.current) return;
    const width = Math.round((height * 16) / 9);
    const ac = new AbortController();
    abortRef.current = ac;
    setPlaying(false);
    // Render at the video's resolution, one frame at a time (Canvas props: see SceneView renderDpr/frameloop)
    setExportState({ dpr: width / Math.max(stage.clientWidth, 1), progress: 0 });
    await nextFrames(3);
    let lastPct = -1;
    try {
      const blob = await tourApi.current.exportVideo({
        width,
        height,
        fps: EXPORT_FPS,
        font: cssVar("--font", "Inter, sans-serif"),
        signal: ac.signal,
        onProgress: (done, total) => {
          const pct = Math.floor((done / total) * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            setExportState((s) => (s ? { ...s, progress: done / total } : s));
          }
        },
      });
      downloadBlob(blob, `${slug(project.name || "home")}-tour-${height}p.mp4`);
      toast(`Tour video saved (${(blob.size / 1048576).toFixed(1)} MB)`, "success");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") toast("Export cancelled");
      else toast((e as Error)?.message || "Could not export the video", "error");
    } finally {
      abortRef.current = null;
      tourTime.current = 0;
      setExportState(null);
    }
  };

  // ---------------------------------------------------------------- editing
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

  const toggleRealistic = () =>
    setRealistic((r) => {
      try {
        localStorage.setItem(REALISTIC_KEY, r ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !r;
    });

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
    <div className={`s3d-panel ${touring ? "s3d-panel--tour" : ""}`}>
      <div className="s3d-stage" ref={stageRef}>
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
          realistic={realistic}
          tour={tourSetup}
          renderDpr={exportState?.dpr}
          frameloop={exportState ? "never" : "always"}
        />
        {touring && <TourOverlay ref={overlayApi} />}
      </div>

      {touring && tourPlan ? (
        <TourBar
          duration={tourPlan.duration}
          timeRef={tourTime}
          playing={playing}
          exportProgress={exportState ? exportState.progress : null}
          canExport={canExportVideo()}
          onPlayPause={() => {
            if (!playing && tourTime.current >= tourPlan.duration) tourTime.current = 0;
            setPlaying((p) => !p);
          }}
          onRestart={() => {
            tourTime.current = 0;
            setPlaying(true);
          }}
          onSeek={(t) => {
            tourTime.current = t;
          }}
          onExport={exportVideo}
          onCancelExport={() => abortRef.current?.abort()}
          onExit={exitTour}
        />
      ) : (
        <>
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
          {/* Presentation: render quality and the cinematic tour */}
          <div className="s3d-corner s3d-toolbar__group" role="toolbar" aria-label="Presentation">
            <button
              className={`s3d-tool ${realistic ? "is-active" : ""}`}
              onClick={toggleRealistic}
              title="Realistic render: soft shadows, ambient occlusion, wood and tile floors"
              aria-pressed={realistic}
            >
              <Icon name="sparkle" />
              <span className="s3d-tool__label">Realistic</span>
            </button>
            <button className="s3d-tool" onClick={startTour} title="Cinematic tour: preview and export a video walkthrough">
              <Icon name="film" />
              <span className="s3d-tool__label">Tour</span>
            </button>
          </div>
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
              Drag item to move · ring rotates · corners scale · side dots stretch · top diamond sets height · R turn 90° · ⌘/Ctrl+D duplicate · Del delete · Pan: middle/right-drag, Space+drag or
              two-finger scroll · F frame
            </span>
          </div>
        </>
      )}
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
