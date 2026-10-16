// Client-side mirror of backend scene_ops: applies an op batch to a SceneGraph without mutating it.
// Used for optimistic UI; the server result (Firestore snapshot) always wins.
//
// surface.material semantics:
//   {allWalls}  → palette.wall = tint (when tint is set) and every per-wall override is cleared
//   {allFloors} → palette.floor = tint (when tint is set) and every per-room override is cleared
//   {wallId}    → that wall's color = tint (null clears the override)
//   {roomId}    → that room's floorColor = tint (null clears the override)

import type { ItemInstance, SceneGraph, SceneOp } from "../../lib/types";

/** Ids of existing items an op needs (item.add needs none). */
export function opItemId(op: SceneOp): string | null {
  return op.op === "item.add" || op.op === "surface.material" ? null : op.id;
}

export function applyOpsLocal(graph: SceneGraph, ops: SceneOp[]): SceneGraph {
  const g: SceneGraph = structuredClone(graph);
  const level = g.levels[0];
  if (!level) return g;
  const find = (id: string): ItemInstance | undefined => level.items.find((i) => i.id === id);

  for (const op of ops) {
    switch (op.op) {
      case "item.add": {
        level.items = level.items.filter((i) => i.id !== op.item.id);
        level.items.push(structuredClone(op.item));
        break;
      }
      case "item.move": {
        const it = find(op.id);
        if (it) it.position = [...op.position];
        break;
      }
      case "item.rotate": {
        const it = find(op.id);
        if (it) it.rotationY = op.rotationY;
        break;
      }
      case "item.resize": {
        const it = find(op.id);
        if (it) it.dims = { ...op.dims };
        break;
      }
      case "item.replace": {
        const it = find(op.id);
        if (it) it.assetId = op.assetId;
        break;
      }
      case "item.remove": {
        level.items = level.items.filter((i) => i.id !== op.id);
        break;
      }
      case "surface.material": {
        const tint = op.material.tint;
        const t = op.target;
        if ("allWalls" in t) {
          if (tint) g.meta.palette.wall = tint;
          level.walls.forEach((w) => (w.color = null));
        } else if ("allFloors" in t) {
          if (tint) g.meta.palette.floor = tint;
          level.rooms.forEach((r) => (r.floorColor = null));
        } else if ("wallId" in t) {
          const w = level.walls.find((x) => x.id === t.wallId);
          if (w) w.color = tint;
        } else if ("roomId" in t) {
          const r = level.rooms.find((x) => x.id === t.roomId);
          if (r) r.floorColor = tint;
        }
        break;
      }
    }
  }
  return g;
}

/** True when every item an op touches still exists in the graph (used to replay ops after a conflict). */
export function opsStillValid(graph: SceneGraph, ops: SceneOp[]): boolean {
  const ids = new Set((graph.levels[0]?.items || []).map((i) => i.id));
  return ops.every((op) => {
    const id = opItemId(op);
    return id === null || ids.has(id);
  });
}
