// Stage "reviewing_plan": edit the parsed plan. Every committed change is saved (debounced PUT /plan);
// "Looks right" flushes the save and runs the confirm_plan action. A change that puts an object on the same spot
// as another or on top of it is not committed: the plan snaps back to the last committed state.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelProps } from "./panelTypes";
import { CATALOG_CATEGORIES, type FloorPlan } from "../lib/types";
import { api } from "../lib/api";
import { Icon, Spinner, toast } from "../components/ui";
import PlanCanvas, { type PlanCanvasControls } from "./PlanEditor/PlanEditor";
import Inspector from "./PlanEditor/Inspector";
import { LayersMenu, ZoomControls, isTypingTarget } from "./PlanEditor/Toolbar";
import { buildEditorObjects, cloneObjects, exportFloorPlan, findNewOverlap, fmtPlan, isWall, type EditorObject } from "./PlanEditor/model";
import { DEFAULT_LAYERS, type LayerVisibility } from "./PlanEditor/hitTest";
import { History } from "./PlanEditor/history";
import { makeUserBox } from "./PlanEditor/AddBoxTool";
import "./panels.css";

const SAVE_DELAY = 1000;

export default function PlanReviewPanel({ conversation, project, files, onClose }: PanelProps) {
  const plan = project.floorPlan || null;
  const planKey = plan ? `${plan.id}:${project.currentJobId || ""}` : null;

  const baseRef = useRef<FloorPlan | null>(null);
  const historyRef = useRef(new History<EditorObject[]>());
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "addBox">("select");
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [opacity, setOpacity] = useState(0.35);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [addPop, setAddPop] = useState<{ rect: { x: number; y: number; w: number; h: number }; anchor: { x: number; y: number } } | null>(null);
  const [addCategory, setAddCategory] = useState<string>("Sofa");
  const [addLabel, setAddLabel] = useState("");
  const [saving, setSaving] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [confirming, setConfirming] = useState(false);
  const [, force] = useState(0);
  const controls = useRef<PlanCanvasControls | null>(null);
  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef<EditorObject[] | null>(null);

  // Load once per plan identity; later snapshots of the same plan are echoes of our own saves.
  useEffect(() => {
    if (!plan || !planKey || planKey === loadedKey) return;
    baseRef.current = plan;
    const objs = buildEditorObjects(plan);
    historyRef.current.reset(objs);
    setObjects(objs);
    setSelectedId(null);
    setLoadedKey(planKey);
  }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const objs = dirtyRef.current;
    if (!objs || !baseRef.current) return;
    dirtyRef.current = null;
    setSaving("saving");
    try {
      await api.savePlan(project.id, exportFloorPlan(baseRef.current, objs));
      setSaving(dirtyRef.current ? "pending" : "saved");
    } catch (e: any) {
      dirtyRef.current = dirtyRef.current || objs;
      setSaving("error");
      toast(e?.message || "Could not save the plan", "error");
    }
  }, [project.id]);

  useEffect(() => () => void flush(), [flush]);

  /** Save a change; false (and the last committed state restored) when it makes two objects overlap. */
  const commit = useCallback(
    (objs: EditorObject[]) => {
      const prev = historyRef.current.current();
      const clash = prev && findNewOverlap(prev, objs);
      if (prev && clash) {
        setObjects(prev);
        toast(`Objects can't overlap: “${clash[0].name}” would sit on “${clash[1].name}”.`, "error");
        force((n) => n + 1);
        return false;
      }
      historyRef.current.push(objs);
      dirtyRef.current = objs;
      setSaving("pending");
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
      force((n) => n + 1);
      return true;
    },
    [flush],
  );

  const onObjectsChange = (objs: EditorObject[], isCommit: boolean) => {
    setObjects(objs);
    if (isCommit) commit(objs);
  };

  const selected = objects.find((o) => o.id === selectedId) || null;

  const updateSelected = (next: EditorObject, isCommit: boolean) => {
    const objs = objects.map((o) => (o.id === next.id ? next : o));
    setObjects(objs);
    if (isCommit) commit(objs);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const objs = objects.filter((o) => o.id !== selectedId);
    setObjects(objs);
    setSelectedId(null);
    commit(objs);
  };

  const rotateSelected = (delta: number) => {
    if (!selected || isWall(selected)) return;
    updateSelected({ ...selected, rotation: ((((selected.rotation || 0) + delta) % 360) + 360) % 360 }, true);
  };

  const undo = () => {
    const s = historyRef.current.undo();
    if (s) {
      setObjects(s);
      setSelectedId((id) => (s.some((o) => o.id === id) ? id : null));
      dirtyRef.current = s;
      setSaving("pending");
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
    }
    force((n) => n + 1);
  };
  const redo = () => {
    const s = historyRef.current.redo();
    if (s) {
      setObjects(s);
      dirtyRef.current = s;
      setSaving("pending");
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY);
    }
    force((n) => n + 1);
  };

  // Keyboard shortcuts while mounted
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key.toLowerCase() === "r" && !mod && selected && !isWall(selected)) {
      e.preventDefault();
      rotateSelected(e.shiftKey ? -45 : 45);
    } else if (e.key === "Escape") {
      setSelectedId(null);
      setAddPop(null);
      setTool("select");
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const planMeta = useMemo(
    () =>
      plan
        ? { width: plan.width, height: plan.height, units: plan.units, rooms: plan.rooms || [], sourceImage: plan.sourceImage }
        : null,
    [plan?.width, plan?.height, plan?.units, plan?.rooms, plan?.sourceImage], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const addBox = () => {
    if (!addPop) return;
    const box = makeUserBox(addPop.rect, addCategory, addLabel || addCategory);
    const objs = [...cloneObjects(objects), box];
    setObjects(objs);
    if (commit(objs)) setSelectedId(box.id);
    setAddPop(null);
    setAddLabel("");
    setTool("select");
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      await flush();
      await api.action(conversation.id, "confirm_plan");
    } catch (e: any) {
      toast(e?.message || "Could not continue", "error");
    } finally {
      setConfirming(false);
    }
  };

  if (!plan || !planMeta) {
    return (
      <div className="cpanel">
        <div className="cpanel__head">
          <div className="cpanel__title">
            <strong>Plan review</strong>
            <span>Waiting for the parsed plan…</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close canvas">
            <Icon name="close" />
          </button>
        </div>
        <div className="crop-loading">
          <Spinner />
        </div>
      </div>
    );
  }

  const counts = {
    walls: objects.filter((o) => o.type === "wall").length,
    items: objects.filter((o) => o.type !== "wall").length,
  };
  const savingText =
    saving === "saving" ? "Saving…" : saving === "pending" ? "Unsaved changes" : saving === "error" ? "Save failed" : saving === "saved" ? "All changes saved" : "";
  const busy = conversation.busy || confirming;

  return (
    <div className="cpanel">
      <div className="cpanel__head">
        <div className="cpanel__title">
          <strong>Review your plan</strong>
          <span>
            {fmtPlan(plan.width, plan.units)} × {fmtPlan(plan.height, plan.units)} · {counts.walls} walls · {counts.items} items
          </span>
        </div>
        <div className="seg" role="group" aria-label="Tool">
          <button className={tool === "select" ? "is-active" : ""} onClick={() => setTool("select")}>
            Select
          </button>
          <button
            className={tool === "addBox" ? "is-active" : ""}
            onClick={() => {
              setTool("addBox");
              setSelectedId(null);
            }}
            title="Drag a rectangle to add a box"
          >
            <Icon name="plus" size={14} /> Add box
          </button>
        </div>
        <span className="cpanel__sep hide-sm" />
        <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!historyRef.current.canUndo} onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" title="Redo (Shift+Ctrl+Z)" aria-label="Redo" disabled={!historyRef.current.canRedo} onClick={redo}>
          <Icon name="redo" />
        </button>
        <span className="cpanel__sep hide-sm" />
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
          mode="edit"
          tool={tool}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setAddPop(null);
          }}
          layers={layers}
          overlayUrl={files?.planUrl}
          overlayOpacity={opacity}
          onObjectsChange={onObjectsChange}
          onAddRect={(rect, anchor) => {
            setAddPop({ rect, anchor });
            setAddLabel("");
          }}
          controlsRef={controls}
          onPointerWorld={setPointer}
          renderOverlay={() =>
            addPop ? (
              <div
                className="addbox-pop card"
                style={{ left: addPop.anchor.x, top: addPop.anchor.y + 10 }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <strong style={{ fontSize: 13 }}>New box</strong>
                <select className="select" value={addCategory} onChange={(e) => setAddCategory(e.target.value)} autoFocus>
                  {CATALOG_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder={`Label (e.g. ${addCategory})`}
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBox()}
                />
                <div className="addbox-pop__actions">
                  <button className="btn btn--sm btn--ghost" onClick={() => setAddPop(null)}>
                    Cancel
                  </button>
                  <button className="btn btn--sm btn--primary" onClick={addBox}>
                    Add
                  </button>
                </div>
              </div>
            ) : null
          }
        />
        {selected && (
          <Inspector
            obj={selected}
            units={plan.units}
            onChange={updateSelected}
            onDelete={deleteSelected}
            onRotate90={() => rotateSelected(90)}
            onClose={() => setSelectedId(null)}
          />
        )}
        <div className="cpanel__status">
          {pointer && (
            <span className="mono">
              {fmtPlan(Math.max(0, pointer.x), plan.units, 2)}, {fmtPlan(Math.max(0, pointer.y), plan.units, 2)}
            </span>
          )}
        </div>
      </div>

      <div className="cpanel__foot">
        <span className="grow">
          {tool === "addBox" ? "Drag on the plan to draw a box for something the parser missed." : savingText || "Fix anything that looks wrong, then continue."}
        </span>
        <button className="btn btn--primary" onClick={confirm} disabled={busy}>
          {confirming ? <Spinner /> : <Icon name="check" size={16} />} Looks right
        </button>
      </div>
    </div>
  );
}
