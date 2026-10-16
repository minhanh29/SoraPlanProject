// Optimistic scene op store.
// The rendered graph = server graph (Firestore scenes/{projectId}) + ops not yet reflected by a snapshot.
// Batches are sent one at a time; a 409 (SCENE_VERSION_CONFLICT) waits for the newer snapshot, then replays
// the batch once if its items still exist. Undo/redo are server-side so UI and AI edits share one history.

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { api, ApiError } from "../lib/api";
import type { SceneDoc, SceneGraph, SceneOp } from "../lib/types";
import { toast } from "../components/ui";
import { applyOpsLocal, opsStillValid } from "../canvas/Scene3D/sceneOps";
import { useDoc } from "./useFirestore";

type Status = "queued" | "sending" | "sent" | "conflict";

interface PendingBatch {
  key: number;
  ops: SceneOp[];
  label?: string;
  status: Status;
  /** Server version after the batch was applied (status "sent"). */
  ackVersion?: number;
  /** Version the server rejected (status "conflict"); replay once a newer snapshot arrives. */
  conflictVersion?: number;
  retried: boolean;
}

export interface SceneStore {
  graph: SceneGraph | null;
  version: number;
  canUndo: boolean;
  canRedo: boolean;
  loading: boolean;
  /** Apply ops optimistically and send them as one batch. */
  apply: (ops: SceneOp[], label?: string) => void;
  undo: () => void;
  redo: () => void;
}

let batchSeq = 0;

export function useScene(projectId: string | null): SceneStore {
  const doc = useDoc<SceneDoc>(projectId ? `scenes/${projectId}` : null);
  const queue = useRef<PendingBatch[]>([]);
  const busy = useRef(false);
  const lastAck = useRef(0);
  const docRef = useRef<SceneDoc | null | undefined>(doc);
  docRef.current = doc;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const remove = (b: PendingBatch) => {
    queue.current = queue.current.filter((x) => x !== b);
  };

  const pump = useCallback(async () => {
    if (busy.current || !projectId) return;
    // Keep order: only send when the oldest unsent batch is ready to go.
    const next = queue.current.find((b) => b.status !== "sent");
    if (!next || next.status !== "queued") return;
    busy.current = true;
    next.status = "sending";
    const base = Math.max(docRef.current?.version ?? 0, lastAck.current);
    try {
      const res = await api.applyOps(projectId, { baseVersion: base, ops: next.ops, origin: "ui", label: next.label });
      next.status = "sent";
      next.ackVersion = res.newVersion;
      lastAck.current = Math.max(lastAck.current, res.newVersion);
      if ((docRef.current?.version ?? 0) >= res.newVersion) remove(next);
    } catch (e) {
      if (e instanceof ApiError && (e.code === "SCENE_VERSION_CONFLICT" || e.status === 409) && !next.retried) {
        next.retried = true;
        next.conflictVersion = base;
        const latest = docRef.current;
        if (latest && latest.version > base) {
          // The newer snapshot already arrived while we were sending: retry now (the [doc] effect won't fire again)
          if (opsStillValid(latest.graph, next.ops)) next.status = "queued";
          else {
            remove(next);
            toast("Scene changed, try again", "error");
          }
        } else next.status = "conflict";
      } else {
        remove(next);
        toast(e instanceof ApiError && e.status === 409 ? "Scene changed, try again" : "Could not save the change", "error");
      }
    } finally {
      busy.current = false;
      rerender();
      void pump();
    }
  }, [projectId]);

  // Snapshot arrived: drop acknowledged batches, revive conflicted ones.
  useEffect(() => {
    if (!doc) return;
    let changed = false;
    for (const b of [...queue.current]) {
      if (b.status === "sent" && (b.ackVersion ?? Infinity) <= doc.version) {
        remove(b);
        changed = true;
      } else if (b.status === "conflict" && doc.version > (b.conflictVersion ?? -1)) {
        if (opsStillValid(doc.graph, b.ops)) b.status = "queued";
        else {
          remove(b);
          toast("Scene changed, try again", "error");
        }
        changed = true;
      }
    }
    if (changed) rerender();
    void pump();
  }, [doc, pump]);

  // Reset when switching projects.
  useEffect(() => {
    queue.current = [];
    lastAck.current = 0;
    rerender();
  }, [projectId]);

  const apply = useCallback(
    (ops: SceneOp[], label?: string) => {
      if (!ops.length) return;
      queue.current = [...queue.current, { key: ++batchSeq, ops, label, status: "queued", retried: false }];
      rerender();
      void pump();
    },
    [pump],
  );

  const undo = useCallback(() => {
    if (!projectId) return;
    api.undo(projectId).catch(() => toast("Nothing to undo", "info"));
  }, [projectId]);
  const redo = useCallback(() => {
    if (!projectId) return;
    api.redo(projectId).catch(() => toast("Nothing to redo", "info"));
  }, [projectId]);

  const pendingKey = queue.current.map((b) => b.key).join(",");
  const graph = useMemo(() => {
    if (!doc?.graph) return null;
    return queue.current.reduce((g, b) => applyOpsLocal(g, b.ops), doc.graph);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pendingKey]);

  return {
    graph,
    version: doc?.version ?? 0,
    canUndo: (doc?.undoStack?.length ?? 0) > 0,
    canRedo: (doc?.redoStack?.length ?? 0) > 0,
    loading: doc === undefined,
    apply,
    undo,
    redo,
  };
}
