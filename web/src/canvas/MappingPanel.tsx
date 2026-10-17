// Stage "resolving_missing": matched catalog models shown in their boxes with their real footprint,
// unmatched boxes pulse amber with Add model / Skip chips (Add model: pick from the assets or upload a photo),
// a selected skipped box offers Restore (undo the skip), selected matches can be rescaled (§2.4), given another
// model (Change model) or deleted (Delete / Del: a skip, so Restore brings the model back).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelProps } from "./panelTypes";
import type { Dims, MappingEntry } from "../lib/types";
import { api } from "../lib/api";
import { planScale } from "../lib/units";
import { useAssetIndex } from "../hooks/useAssets";
import { Icon, Spinner, toast } from "../components/ui";
import UploadAssetDialog, { type UploadAssetPreset } from "../assets/UploadAssetDialog";
import ResolveModelDialog, { type ResolveTarget } from "./ResolveModelDialog";
import PlanCanvas, { type PlanCanvasControls } from "./PlanEditor/PlanEditor";
import { LayersMenu, ZoomControls, isTypingTarget } from "./PlanEditor/Toolbar";
import { buildEditorObjects, isBox, type BoxObj } from "./PlanEditor/model";
import { DEFAULT_LAYERS, type LayerVisibility } from "./PlanEditor/hitTest";
import { buildDecorations, clampDims, entryState, sameAssetIds, scaleDims } from "./PlanEditor/mapping";
import MappingInspector from "./MappingInspector";
import "./panels.css";

const SEND_DELAY = 500;

/** Small image cache that triggers a redraw when thumbnails finish loading. */
function useImageCache() {
  const cache = useRef(new Map<string, HTMLImageElement>());
  const [, setTick] = useState(0);
  return useCallback((url: string) => {
    let img = cache.current.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => setTick((t) => t + 1);
      img.src = url;
      cache.current.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }, []);
}

export default function MappingPanel({ conversation, project, files, onClose }: PanelProps) {
  const plan = project.floorPlan || null;
  const mapping: Record<string, MappingEntry> = project.mapping || {};
  const missingList = project.missing || [];
  const assets = useAssetIndex();
  const imageFor = useImageCache();

  const objects = useMemo(() => (plan ? buildEditorObjects(plan) : []), [plan]);
  const k = plan ? planScale(plan) : 1;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>({ ...DEFAULT_LAYERS, grid: false });
  const [opacity, setOpacity] = useState(0.2);
  const [lock, setLock] = useState(true);
  const [applyToAll, setApplyToAll] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, Dims>>({});
  const [upload, setUpload] = useState<UploadAssetPreset | null>(null);
  const [resolving, setResolving] = useState<ResolveTarget | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const controls = useRef<PlanCanvasControls | null>(null);
  const sendTimer = useRef<number | null>(null);
  const pendingSend = useRef<{ componentId: string; dims: Dims; applyToSameAsset: boolean } | null>(null);
  const dragStart = useRef<Dims | null>(null);

  // Drop local overrides once the server mapping caught up (and nothing is pending).
  useEffect(() => {
    if (pendingSend.current || dragStart.current) return;
    setOverrides({});
  }, [project.mapping]);

  const flushSend = useCallback(async () => {
    if (sendTimer.current) window.clearTimeout(sendTimer.current);
    sendTimer.current = null;
    const body = pendingSend.current;
    pendingSend.current = null;
    if (!body) return;
    try {
      await api.updateMapping(project.id, body);
    } catch (e: any) {
      toast(e?.message || "Could not save the size", "error");
      setOverrides({});
    }
  }, [project.id]);
  useEffect(() => () => void flushSend(), [flushSend]);

  const setDims = (componentId: string, dims: Dims, send: boolean) => {
    const ids = applyToAll ? sameAssetIds(mapping, componentId) : [componentId];
    setOverrides((cur) => {
      const next = { ...cur };
      for (const id of ids) next[id] = dims;
      return next;
    });
    if (send) {
      pendingSend.current = { componentId, dims, applyToSameAsset: applyToAll };
      if (sendTimer.current) window.clearTimeout(sendTimer.current);
      sendTimer.current = window.setTimeout(() => void flushSend(), SEND_DELAY);
    }
  };

  const decorations = useMemo(
    () => buildDecorations(objects, mapping, missingList, assets, k, overrides, imageFor),
    [objects, mapping, missingList, assets, k, overrides, imageFor],
  );

  const boxes = objects.filter(isBox) as BoxObj[];
  const stateOf = (id: string) => {
    const e = mapping[id];
    return entryState(e, e?.assetId ? assets[e.assetId] : undefined, missingList.some((m) => m.componentId === id));
  };
  const counts = boxes.reduce(
    (acc, b) => {
      const s = stateOf(b.id);
      if (s === "matched" || s === "generating") acc.matched++;
      else if (s === "missing" || s === "failed") acc.missing++;
      else acc.skipped++;
      return acc;
    },
    { matched: 0, missing: 0, skipped: 0 },
  );

  const selected = boxes.find((b) => b.id === selectedId) || null;
  const selEntry = selected ? mapping[selected.id] : undefined;
  const selAsset = selEntry?.assetId ? assets[selEntry.assetId] : undefined;
  const selDims = selected ? overrides[selected.id] || selEntry?.dims || null : null;
  const selState = selected ? stateOf(selected.id) : null;
  const busy = conversation.busy || acting !== null;

  const removable = selState === "matched" || selState === "generating" || selState === "missing" || selState === "failed";
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    if (e.key === "Escape") setSelectedId(null);
    else if ((e.key === "Delete" || e.key === "Backspace") && selected && removable && !busy && !resolving && !upload) {
      e.preventDefault();
      void deleteBox(selected.id);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const runAction = async (key: string, type: "skip_missing" | "continue", args: Record<string, unknown> = {}) => {
    setActing(key);
    try {
      await flushSend();
      await api.action(conversation.id, type, args);
    } catch (e: any) {
      toast(e?.message || "Something went wrong", "error");
    } finally {
      setActing(null);
    }
  };

  /** Delete: the box stays empty in 3D (skipped); selecting it again offers Restore. */
  const deleteBox = (componentId: string) => runAction(`skip:${componentId}`, "skip_missing", { componentIds: [componentId] });

  /** Pick another model for a box (same dialog as Add model). */
  const changeModel = (componentId: string) => {
    const box = boxes.find((b) => b.id === componentId);
    const entry = mapping[componentId];
    const current = entry?.assetId ? assets[entry.assetId] : undefined;
    setResolving({
      componentId,
      label: entry?.label || box?.name || "this item",
      category: entry?.category ?? box?.category ?? null,
      currentName: current?.name,
    });
  };

  /** Undo a Skip: the box needs a model again. */
  const restore = async (componentId: string) => {
    setActing(`restore:${componentId}`);
    try {
      await api.updateMapping(project.id, { componentId, restore: true });
    } catch (e: any) {
      toast(e?.message || "Could not restore this item", "error");
    } finally {
      setActing(null);
    }
  };

  const fitToBox = async () => {
    if (!selected) return;
    pendingSend.current = null;
    if (sendTimer.current) window.clearTimeout(sendTimer.current);
    const ids = applyToAll ? sameAssetIds(mapping, selected.id) : [selected.id];
    const auto = selEntry?.autoDims;
    if (auto) setOverrides((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => !ids.includes(id))));
    try {
      await api.updateMapping(project.id, { componentId: selected.id, reset: true, applyToSameAsset: applyToAll });
    } catch (e: any) {
      toast(e?.message || "Could not reset the size", "error");
    }
  };

  if (!plan) {
    return (
      <div className="cpanel">
        <div className="crop-loading">
          <Spinner />
        </div>
      </div>
    );
  }

  const planMeta = { width: plan.width, height: plan.height, units: plan.units, rooms: plan.rooms || [], sourceImage: plan.sourceImage };

  return (
    <div className="cpanel">
      <div className="cpanel__head">
        <div className="cpanel__title">
          <strong>Furniture for your {project.style || ""} home</strong>
          <span>Select a model to resize, change or delete it · amber boxes still need a model · select a skipped box to restore it</span>
        </div>
        <span className="hide-sm" style={{ display: "contents" }}>
          <ZoomControls controls={controls} />
        </span>
        <LayersMenu layers={layers} onLayers={setLayers} opacity={opacity} onOpacity={setOpacity} />
        <button className="icon-btn" onClick={onClose} aria-label="Close canvas">
          <Icon name="close" />
        </button>
      </div>

      <div className="cpanel__body">
        <PlanCanvas
          plan={planMeta}
          objects={objects}
          mode="mapping"
          selectedId={selectedId}
          onSelect={setSelectedId}
          layers={layers}
          overlayUrl={files?.planUrl}
          overlayOpacity={opacity}
          decorations={decorations}
          animate={counts.missing > 0}
          footprintLock={lock}
          controlsRef={controls}
          onFootprintChange={(id, w, d, factor, commit) => {
            const entry = mapping[id];
            const base = dragStart.current || overrides[id] || entry?.dims;
            if (!base) return;
            if (!dragStart.current) dragStart.current = base;
            const next = clampDims(factor != null ? scaleDims(base, factor) : { w: w * k, d: d * k, h: base.h });
            setDims(id, next, commit);
            if (commit) dragStart.current = null;
          }}
          renderOverlay={(projectPt, scale) =>
            boxes
              .filter((b) => {
                const s = stateOf(b.id);
                return s === "missing" || s === "failed" || (s === "skipped" && b.id === selectedId);
              })
              .map((b) => {
                const c = projectPt(b.x + b.w / 2, b.y + b.h / 2);
                const entry = mapping[b.id];
                const miss = missingList.find((m) => m.componentId === b.id);
                const label = entry?.label || miss?.label || b.name;
                const category = entry?.category ?? miss?.category ?? b.category ?? null;
                const tall = b.h * scale > 64;
                const style = { left: c.x, top: c.y + (tall ? 14 : 0), flexDirection: tall ? "column" : "row" } as const;
                if (stateOf(b.id) === "skipped") {
                  return (
                    <div key={b.id} className="map-chip map-chip--skipped" style={style}>
                      <button disabled={busy} onClick={() => restore(b.id)} title={`Undo Skip: ${label} needs a model again`}>
                        {acting === `restore:${b.id}` ? <Spinner size={11} /> : <Icon name="undo" size={13} />} Restore
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={b.id} className="map-chip" style={style}>
                    <button
                      disabled={busy}
                      onClick={() => setResolving({ componentId: b.id, label, category })}
                      title={`Pick a model from the assets or upload a photo of your ${label}`}
                    >
                      <Icon name="plus" size={13} /> Add model
                    </button>
                    <button className="map-chip__skip" disabled={busy} onClick={() => deleteBox(b.id)}>
                      {acting === `skip:${b.id}` ? <Spinner size={11} /> : "Skip"}
                    </button>
                  </div>
                );
              })
          }
        />
        {selected && selEntry && selState === "matched" && selDims && (
          <MappingInspector
            label={selEntry.label || selected.name}
            entry={selEntry}
            asset={selAsset}
            dims={selDims}
            units={plan.units}
            lock={lock}
            onLock={setLock}
            applyToAll={applyToAll}
            onApplyToAll={setApplyToAll}
            sameAssetCount={sameAssetIds(mapping, selected.id).length}
            onDims={(d) => setDims(selected.id, d, true)}
            onFit={fitToBox}
            onChange={() => changeModel(selected.id)}
            onDelete={() => deleteBox(selected.id)}
            onClose={() => setSelectedId(null)}
            disabled={busy}
          />
        )}
        {selected && selState === "generating" && (
          <aside className="map-inspector card">
            <div className="map-inspector__head">
              <strong>{selAsset?.name || selected.name}</strong>
            </div>
            <span className="subtle">
              <Spinner size={12} /> Generating the 3D model · {Math.round(selAsset?.progress || 0)}%
            </span>
            <div className="map-actions">
              <button className="btn btn--sm" onClick={() => changeModel(selected.id)} disabled={busy}>
                <Icon name="swap" size={15} /> Change model
              </button>
              <button className="btn btn--sm pe-danger" onClick={() => deleteBox(selected.id)} disabled={busy} title="Delete (Del)">
                <Icon name="trash" size={15} /> Delete
              </button>
            </div>
          </aside>
        )}
      </div>

      <div className="cpanel__foot">
        <span className="grow">
          {counts.matched} matched · {counts.missing} missing
          {counts.skipped ? ` · ${counts.skipped} skipped` : ""}
        </span>
        {counts.missing > 0 && (
          <button className="btn" disabled={busy} onClick={() => runAction("skip", "skip_missing")}>
            {acting === "skip" ? <Spinner /> : null} Skip remaining
          </button>
        )}
        <button className="btn btn--primary" disabled={busy} onClick={() => runAction("continue", "continue")}>
          {acting === "continue" ? <Spinner /> : <Icon name="cube" size={16} />} Continue
        </button>
      </div>

      <ResolveModelDialog
        target={resolving}
        projectId={project.id}
        style={project.style}
        assets={assets}
        onUpload={(t) => setUpload({ name: t.label, category: t.category, projectId: project.id, componentId: t.componentId })}
        onClose={() => setResolving(null)}
      />
      <UploadAssetDialog
        open={upload !== null}
        onClose={() => setUpload(null)}
        preset={upload || undefined}
        onUploaded={() => {
          setUpload(null);
          toast("Generating your 3D model — it will appear in its box when ready.", "success");
        }}
      />
    </div>
  );
}
