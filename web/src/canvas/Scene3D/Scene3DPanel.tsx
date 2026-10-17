// Stage scene_ready: the isometric 3D world with direct manipulation (docs/10 §2.5), the realistic render and
// the cinematic tour: candidate shots from a visibility analysis → previews rendered here → Gemini directs
// (picks, orders, moves) → preview + MP4 export. The plan is cached per scene version in this browser.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelProps } from "../panelTypes";
import type { Asset, ItemInstance, SceneGraph, SceneOp } from "../../lib/types";
import { api } from "../../lib/api";
import { Icon, Spinner, toast } from "../../components/ui";
import { useScene } from "../../hooks/useScene";
import { useAssetIndex } from "../../hooks/useAssets";
import { realDims } from "../../lib/furniture";
import { cssVar } from "../../lib/theme";
import SceneView, { type SnapshotApi, type TourSetup } from "./SceneView";
import Toolbar from "./Toolbar";
import ReplacePicker from "./ReplacePicker";
import AddPicker from "./AddPicker";
import TourBar from "./TourBar";
import TourOverlay, { type TourOverlayApi } from "./TourOverlay";
import type { TourApi } from "./TourDirector";
import type { CameraApi, Projection } from "./IsoCamera";
import type { OverlayImageStatus } from "./PlanOverlay";
import {
  buildTour,
  candidatePose,
  defaultChoices,
  roomConnections,
  shotCandidates,
  type Candidate,
  type ShotChoice,
  type Tour,
} from "./cinematic";
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
const PREVIEW_W = 384; // candidate previews sent to Gemini (16:9)
const PREVIEW_H = 216;
type PlanSource = "gemini" | "auto";

const planCacheKey = (projectId: string, version: number) => `soraplan.tour.${projectId}.${version}`;
function readPlan(key: string): { shots: ShotChoice[]; source: PlanSource } | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v && Array.isArray(v.shots) ? v : null;
  } catch {
    return null;
  }
}
function writePlan(key: string, value: { shots: ShotChoice[]; source: PlanSource }) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** What the AI director knows about the home besides the previews. */
function houseSummary(graph: SceneGraph) {
  const level = graph.levels[0];
  const conn = roomConnections(graph);
  return (level?.rooms || []).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    area: Math.round((r.area || 0) * 10) / 10,
    items: (level?.items || []).filter((it) => it.roomId === r.id).map((it) => it.label || it.category || "item").slice(0, 40),
    connectsTo: conn[r.id] || [],
  }));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
const nextFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

export default function Scene3DPanel({ conversation, project, files, onClose }: PanelProps) {
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

  // ---------------------------------------------------------------- sidebar picture
  // Until the home is built the sidebar shows the plan. Once it is (or after a rebuild), this view is sent as the
  // layout reference and the API has Gemini paint a realistic photo of the home from it.
  const snapshotRef = useRef<SnapshotApi | null>(null);
  const snapshotting = useRef(false);
  const needsThumb = conversation.thumbnailKind !== "scene" || !!conversation.thumbnailStale;
  const hasGraph = !!graph;
  useEffect(() => {
    if (!needsThumb || !hasGraph || touring || selectedId) return;
    const t = window.setTimeout(async () => {
      const snap = snapshotRef.current;
      if (!snap || snapshotting.current) return;
      snapshotting.current = true;
      try {
        await api.saveSceneThumbnail(project.id, await snap.capture(768));
      } catch {
        /* keep the plan thumbnail; the next visit tries again */
      } finally {
        snapshotting.current = false;
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, [needsThumb, hasGraph, touring, selectedId, project.id]);

  const style = graph?.meta.style;
  const [tourPlan, setTourPlan] = useState<Tour | null>(null);
  const [planning, setPlanning] = useState<string | null>(null); // status line while planning
  const [planSource, setPlanSource] = useState<PlanSource | null>(null);
  const planRun = useRef(0); // ignore a planning run that finished after the tour was closed / restarted

  const onTourFrame = useCallback((f: Parameters<TourOverlayApi["update"]>[0]) => overlayApi.current?.update(f), []);
  const onTourEnd = useCallback(() => setPlaying(false), []);
  const tourSetup: TourSetup | null = useMemo(
    () => (touring ? { plan: tourPlan, playing, timeRef: tourTime, apiRef: tourApi, onFrame: onTourFrame, onEnd: onTourEnd } : null),
    [touring, tourPlan, playing, onTourFrame, onTourEnd],
  );

  /**
   * Candidates from the visibility analysis → a preview of each → Gemini picks and orders the shots. Falls back to
   * the automatic choice when the AI director is unavailable. `force` skips the per-scene-version cache.
   */
  const makePlan = async (force: boolean) => {
    if (!graph) return;
    const run = ++planRun.current;
    const opts = { title: project.name || "Your home", subtitle: style ? `${style} home` : undefined };
    const candidates: Candidate[] = shotCandidates(graph);
    const key = planCacheKey(project.id, scene.version);
    const cached = force ? null : readPlan(key);
    if (cached) {
      setTourPlan(buildTour(graph, candidates, cached.shots, opts));
      setPlanSource(cached.source);
      return;
    }
    setTourPlan(null);
    setPlanning("Looking at every room…");
    let images: string[] = [];
    const stage = stageRef.current;
    if (stage && tourApi.current && candidates.length) {
      setExportState({ dpr: PREVIEW_W / Math.max(stage.clientWidth, 1), progress: 0 });
      await nextFrames(3);
      try {
        images = await tourApi.current.renderStills(candidates.map(candidatePose), PREVIEW_W, PREVIEW_H);
      } catch {
        images = [];
      } finally {
        setExportState(null);
      }
    }
    if (run !== planRun.current) return;
    setPlanning("Gemini is directing your tour…");
    let shots: ShotChoice[];
    let source: PlanSource;
    try {
      const res = await api.planTour(project.id, {
        title: opts.title,
        style,
        rooms: houseSummary(graph),
        candidates: candidates.map((c, i) => ({ id: c.id, roomId: c.roomId, description: c.description, score: Math.round(c.score * 100) / 100, image: images[i] })),
      });
      shots = res.shots.map((s) => ({ candidateId: s.candidateId, move: s.move as ShotChoice["move"], duration: s.duration }));
      source = "gemini";
    } catch {
      shots = defaultChoices(graph, candidates);
      source = "auto";
      if (run === planRun.current) toast("The AI director is unavailable, so this is the automatic tour.");
    }
    if (run !== planRun.current) return;
    writePlan(key, { shots, source });
    setTourPlan(buildTour(graph, candidates, shots, opts));
    setPlanSource(source);
    setPlanning(null);
  };

  const playFromStart = () => {
    tourTime.current = 0;
    setPlaying(true);
  };

  const startTour = () => {
    setSelectedId(null);
    setOverlay(false);
    tourTime.current = 0;
    setPlaying(false);
    setTourPlan(null);
    setTouring(true);
  };
  // Plan once the tour director is mounted (it renders the candidate previews)
  useEffect(() => {
    if (!touring || tourPlan || planning) return;
    let cancelled = false;
    nextFrames(2).then(async () => {
      if (cancelled) return;
      await makePlan(false);
      if (!cancelled) playFromStart();
    });
    return () => {
      cancelled = true;
    };
  }, [touring]); // eslint-disable-line react-hooks/exhaustive-deps

  const replan = async () => {
    setPlaying(false);
    await makePlan(true);
    playFromStart();
  };
  const exitTour = () => {
    abortRef.current?.abort();
    planRun.current++;
    setPlanning(null);
    setExportState(null);
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
          snapshotRef={snapshotRef}
        />
        {touring && <TourOverlay ref={overlayApi} />}
      </div>

      {touring && !tourPlan ? (
        <div className="s3d-planning card" role="status" aria-live="polite">
          <Spinner size={16} />
          <div>
            <strong>Planning your tour</strong>
            <span className="subtle">{planning || "Getting ready…"}</span>
          </div>
          <button className="btn btn--sm" onClick={exitTour}>Cancel</button>
        </div>
      ) : touring && tourPlan ? (
        <TourBar
          duration={tourPlan.duration}
          source={planSource}
          replanning={!!planning}
          onReplan={replan}
          timeRef={tourTime}
          playing={playing}
          exportProgress={exportState ? exportState.progress : null}
          canExport={canExportVideo()}
          onPlayPause={() => {
            if (!playing && tourTime.current >= tourPlan.duration) tourTime.current = 0;
            setPlaying((p) => !p);
          }}
          onRestart={playFromStart}
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
              Drag item to move · R turn 90° · ⌘/Ctrl+D duplicate · Del delete · Space+drag or
              two-finger scroll · Middle mouse moves camera
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
