"""Scene ops: apply / validate / invert OpBatches and persist scenes/{projectId} (+ ops log).

The pure part (`apply_ops`) is shared by UI edits, Gemini tools and undo/redo. Each committed batch
stores its inverse so undo is just "apply the inverse"; history (undoStack/redoStack of batch ids)
lives on the scene doc so the UI and the AI share one history.
"""
import copy
import logging
import math
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..errors import AppException, ConflictException, NotFoundException
from .common import SERVER_TIMESTAMP, get_owned
from .geometry import obb_corners, obb_overlap

logger = logging.getLogger("api.scene_ops")

HISTORY_LIMIT = 50
MIN_DIM, MAX_DIM = 0.05, 12.0

AssetLookup = Callable[[str], Optional[dict]]


class OpError(ValueError):
    pass


def _level(graph: dict) -> dict:
    levels = graph.get("levels") or []
    if not levels:
        raise OpError("Scene has no level")
    return levels[0]


def _item(level: dict, item_id: str) -> dict:
    for it in level.get("items") or []:
        if it["id"] == item_id:
            return it
    raise OpError(f"Unknown item '{item_id}'")


def _vec3(v: Any) -> List[float]:
    if not isinstance(v, (list, tuple)) or len(v) != 3 or not all(isinstance(c, (int, float)) and math.isfinite(c) for c in v):
        raise OpError("position must be [x, y, z] numbers")
    return [round(float(v[0]), 4), round(float(v[1]), 4), round(float(v[2]), 4)]


def _dims(d: Any) -> Dict[str, float]:
    try:
        out = {k: round(float(d[k]), 4) for k in ("w", "d", "h")}
    except Exception:
        raise OpError("dims must be {w, d, h}")
    if not all(MIN_DIM <= v <= MAX_DIM for v in out.values()):
        raise OpError(f"dims must be between {MIN_DIM} and {MAX_DIM} m")
    return out


def _color(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, str) and len(v) == 7 and v.startswith("#"):
        try:
            int(v[1:], 16)
            return v.upper()
        except ValueError:
            pass
    raise OpError("tint must be a #RRGGBB color or null")


def refit_dims_for_asset(old_dims: Dict[str, float], asset: Optional[dict]) -> Dict[str, float]:
    """Swap a model while keeping its footprint: uniform fit of the new model into the old w × d."""
    native = (asset or {}).get("dims")
    if not native or not native.get("w") or not native.get("d") or not native.get("h"):
        return dict(old_dims)
    s = min(old_dims["w"] / native["w"], old_dims["d"] / native["d"])
    return {"w": round(native["w"] * s, 4), "d": round(native["d"] * s, 4), "h": round(native["h"] * s, 4)}


def _surface_snapshot(graph: dict) -> dict:
    level = _level(graph)
    return {
        "op": "surface.restore",
        "palette": dict(graph["meta"]["palette"]),
        "walls": {w["id"]: w.get("color") for w in level.get("walls") or []},
        "rooms": {r["id"]: r.get("floorColor") for r in level.get("rooms") or []},
    }


def apply_ops(
    graph: dict,
    ops: List[dict],
    asset_lookup: Optional[AssetLookup] = None,
) -> Tuple[dict, List[dict], List[dict]]:
    """Apply ops to a copy of `graph`. Returns (new_graph, inverse_ops, normalized_ops).

    Raises OpError on the first invalid op (the whole batch is rejected).
    """
    g = copy.deepcopy(graph)
    level = _level(g)
    level.setdefault("items", [])
    inverse: List[dict] = []
    applied: List[dict] = []

    for raw in ops:
        op = dict(raw)
        kind = op.get("op")
        if kind == "item.add":
            item = dict(op.get("item") or {})
            if not item.get("id"):
                raise OpError("item.add needs item.id")
            if any(it["id"] == item["id"] for it in level["items"]):
                raise OpError(f"Item '{item['id']}' already exists")
            item["position"] = _vec3(item.get("position"))
            item["dims"] = _dims(item.get("dims"))
            item["rotationY"] = float(item.get("rotationY") or 0.0)
            item.setdefault("label", "Item")
            item.setdefault("category", None)
            item.setdefault("assetId", None)
            item.setdefault("scaleMode", "uniform")
            item.setdefault("addedBy", "user")
            index = op.get("index")
            if isinstance(index, int) and 0 <= index <= len(level["items"]):
                level["items"].insert(index, item)  # undo of a delete restores the original order
            else:
                level["items"].append(item)
            op["item"] = item
            inverse.insert(0, {"op": "item.remove", "id": item["id"]})
        elif kind == "item.move":
            it = _item(level, op.get("id"))
            inverse.insert(0, {"op": "item.move", "id": it["id"], "position": list(it["position"])})
            it["position"] = op["position"] = _vec3(op.get("position"))
        elif kind == "item.rotate":
            it = _item(level, op.get("id"))
            r = op.get("rotationY")
            if not isinstance(r, (int, float)) or not math.isfinite(r):
                raise OpError("rotationY must be a number")
            inverse.insert(0, {"op": "item.rotate", "id": it["id"], "rotationY": it["rotationY"]})
            it["rotationY"] = op["rotationY"] = round(float(r), 5)
        elif kind == "item.resize":
            it = _item(level, op.get("id"))
            inverse.insert(0, {"op": "item.resize", "id": it["id"], "dims": dict(it["dims"])})
            it["dims"] = op["dims"] = _dims(op.get("dims"))
        elif kind == "item.replace":
            it = _item(level, op.get("id"))
            asset_id = op.get("assetId")
            if not asset_id or not isinstance(asset_id, str):
                raise OpError("item.replace needs assetId")
            asset = asset_lookup(asset_id) if asset_lookup else None
            if asset_lookup and asset is None:
                raise OpError(f"Unknown asset '{asset_id}'")
            new_dims = _dims(op["dims"]) if op.get("dims") else refit_dims_for_asset(it["dims"], asset)
            inverse.insert(0, {"op": "item.replace", "id": it["id"], "assetId": it.get("assetId"), "dims": dict(it["dims"]),
                               "category": it.get("category"), "label": it.get("label")})
            it["assetId"] = asset_id
            it["dims"] = op["dims"] = new_dims
            if op.get("category") or asset:
                it["category"] = op.get("category") or (asset or {}).get("category") or it.get("category")
            if op.get("label"):
                it["label"] = op["label"]
        elif kind == "item.remove":
            it = _item(level, op.get("id"))
            index = level["items"].index(it)
            level["items"] = [x for x in level["items"] if x["id"] != it["id"]]
            inverse.insert(0, {"op": "item.add", "item": copy.deepcopy(it), "index": index})
        elif kind == "surface.material":
            target = op.get("target") or {}
            tint = _color((op.get("material") or {}).get("tint"))
            inverse.insert(0, _surface_snapshot(g))
            if target.get("allWalls"):
                if tint:
                    g["meta"]["palette"]["wall"] = tint
                for w in level.get("walls") or []:
                    w["color"] = None
            elif target.get("allFloors"):
                if tint:
                    g["meta"]["palette"]["floor"] = tint
                for r in level.get("rooms") or []:
                    r["floorColor"] = None
            elif target.get("wallId"):
                wall = next((w for w in level.get("walls") or [] if w["id"] == target["wallId"]), None)
                if not wall:
                    raise OpError(f"Unknown wall '{target['wallId']}'")
                wall["color"] = tint
            elif target.get("roomId"):
                room = next((r for r in level.get("rooms") or [] if r["id"] == target["roomId"]), None)
                if not room:
                    raise OpError(f"Unknown room '{target['roomId']}'")
                room["floorColor"] = tint
            else:
                raise OpError("surface.material needs a target")
            op["material"] = {"tint": tint}
        elif kind == "surface.restore":  # internal: inverse of surface.material
            inverse.insert(0, _surface_snapshot(g))
            g["meta"]["palette"] = dict(op["palette"])
            for w in level.get("walls") or []:
                w["color"] = (op.get("walls") or {}).get(w["id"])
            for r in level.get("rooms") or []:
                r["floorColor"] = (op.get("rooms") or {}).get(r["id"])
        else:
            raise OpError(f"Unsupported op '{kind}'")
        applied.append(op)
    return g, inverse, applied


def compute_warnings(graph: dict, item_ids: List[str]) -> List[dict]:
    """Collision / bounds warnings for the touched items."""
    level = _level(graph)
    items = level.get("items") or []
    by_id = {it["id"]: it for it in items}
    b = graph.get("meta", {}).get("bounds") or {}
    warnings: List[dict] = []
    seen = set()
    for iid in item_ids:
        it = by_id.get(iid)
        if not it:
            continue
        mine = obb_corners((it["position"][0], it["position"][2]), it["dims"]["w"], it["dims"]["d"], it["rotationY"])
        for other in items:
            if other["id"] == iid:
                continue
            key = tuple(sorted((iid, other["id"])))
            if key in seen:
                continue
            theirs = obb_corners((other["position"][0], other["position"][2]), other["dims"]["w"], other["dims"]["d"], other["rotationY"])
            if obb_overlap(mine, theirs):
                seen.add(key)
                warnings.append({
                    "code": "COLLISION",
                    "itemIds": list(key),
                    "message": f"{it.get('label', iid)} overlaps {other.get('label', other['id'])}",
                })
        if b:
            xs = [p[0] for p in mine]
            zs = [p[1] for p in mine]
            if min(xs) < b["minX"] - 0.05 or max(xs) > b["maxX"] + 0.05 or min(zs) < b["minZ"] - 0.05 or max(zs) > b["maxZ"] + 0.05:
                warnings.append({"code": "OUT_OF_BOUNDS", "itemIds": [iid], "message": f"{it.get('label', iid)} is outside the plan"})
    return warnings


def touched_item_ids(ops: List[dict]) -> List[str]:
    out = []
    for op in ops:
        if op.get("op") == "item.add":
            out.append(op["item"]["id"])
        elif op.get("op", "").startswith("item.") and op.get("op") != "item.remove":
            out.append(op.get("id"))
    return [i for i in out if i]


class SceneService:
    """Persistence for scenes/{projectId} and scenes/{projectId}/ops/{batchId}."""

    def __init__(self, db, asset_lookup: Optional[AssetLookup] = None):
        self.db = db
        self.asset_lookup = asset_lookup

    def _ref(self, project_id: str):
        return self.db.collection("scenes").document(project_id)

    def get(self, project_id: str, uid: str) -> dict:
        get_owned(self.db, "projects", project_id, uid)
        snap = self._ref(project_id).get()
        if not snap.exists:
            raise NotFoundException(detail="This project has no 3D scene yet", code="SCENE_NOT_FOUND")
        return snap.to_dict() or {}

    def get_optional(self, project_id: str) -> Optional[dict]:
        snap = self._ref(project_id).get()
        return (snap.to_dict() or {}) if snap.exists else None

    def save_built(self, project_id: str, uid: str, graph: dict) -> int:
        """Store a freshly built scene; history starts over."""
        existing = self.get_optional(project_id)
        version = int((existing or {}).get("version") or 0) + 1
        graph = {**graph, "version": version}
        self._ref(project_id).set({
            "projectId": project_id,
            "ownerUid": uid,
            "version": version,
            "graph": graph,
            "undoStack": [],
            "redoStack": [],
            "updatedAt": SERVER_TIMESTAMP,
        })
        return version

    def delete(self, project_id: str) -> None:
        ref = self._ref(project_id)
        for s in ref.collection("ops").stream():
            s.reference.delete()
        ref.delete()

    def _commit(self, project_id: str, scene: dict, graph: dict, undo: List[str], redo: List[str]) -> int:
        version = int(scene.get("version") or 0) + 1
        graph["version"] = version
        self._ref(project_id).update({
            "version": version,
            "graph": graph,
            "undoStack": undo[-HISTORY_LIMIT:],
            "redoStack": redo[-HISTORY_LIMIT:],
            "updatedAt": SERVER_TIMESTAMP,
        })
        scene.update({"version": version, "graph": graph, "undoStack": undo, "redoStack": redo})
        return version

    def apply_batch(
        self,
        project_id: str,
        uid: str,
        ops: List[dict],
        origin: str,
        base_version: Optional[int] = None,
        label: Optional[str] = None,
    ) -> dict:
        scene = self.get(project_id, uid)
        current = int(scene.get("version") or 0)
        if base_version is not None and base_version != current:
            raise ConflictException(
                detail=f"Scene is at version {current}, not {base_version}",
                code="SCENE_VERSION_CONFLICT",
            )
        try:
            graph, inverse, applied = apply_ops(scene["graph"], ops, self.asset_lookup)
        except OpError as e:
            raise AppException(status_code=400, code="INVALID_SCENE_OP", detail=str(e))
        warnings = compute_warnings(graph, touched_item_ids(applied))
        batch_ref = self._ref(project_id).collection("ops").document()
        undo = list(scene.get("undoStack") or [])
        redo = list(scene.get("redoStack") or [])
        if origin != "system":  # automatic refits (model became ready) are not user history
            undo, redo = undo + [batch_ref.id], []
        new_version = self._commit(project_id, scene, graph, undo, redo)
        batch_ref.set({
            "ops": applied,
            "inverse": inverse,
            "origin": origin,
            "label": label,
            "baseVersion": current,
            "newVersion": new_version,
            "warnings": warnings,
            "createdAt": SERVER_TIMESTAMP,
        })
        logger.info("Scene %s v%d: %d ops from %s (%s)", project_id, new_version, len(applied), origin, label or "")
        return {"batchId": batch_ref.id, "newVersion": new_version, "applied": len(applied), "warnings": warnings}

    def _replay(self, project_id: str, uid: str, direction: str) -> dict:
        scene = self.get(project_id, uid)
        undo = list(scene.get("undoStack") or [])
        redo = list(scene.get("redoStack") or [])
        source = undo if direction == "undo" else redo
        if not source:
            raise AppException(status_code=409, code=f"NOTHING_TO_{direction.upper()}", detail=f"Nothing to {direction}")
        batch_id = source.pop()
        bref = self._ref(project_id).collection("ops").document(batch_id)
        snap = bref.get()
        if not snap.exists:
            raise AppException(status_code=409, code="HISTORY_LOST", detail="That change is no longer in the history")
        batch = snap.to_dict() or {}
        ops = batch["inverse"] if direction == "undo" else batch["ops"]
        try:
            graph, inverse, _ = apply_ops(scene["graph"], ops, self.asset_lookup)
        except OpError as e:
            raise AppException(status_code=409, code="HISTORY_CONFLICT", detail=f"Cannot {direction}: {e}")
        if direction == "undo":
            redo.append(batch_id)
            bref.update({"undone": True})
        else:
            undo.append(batch_id)
            bref.update({"undone": False, "inverse": inverse})
        version = self._commit(project_id, scene, graph, undo, redo)
        return {"newVersion": version, "batchId": batch_id, "label": batch.get("label")}

    def undo(self, project_id: str, uid: str) -> dict:
        return self._replay(project_id, uid, "undo")

    def redo(self, project_id: str, uid: str) -> dict:
        return self._replay(project_id, uid, "redo")

    def undo_batches(self, project_id: str, uid: str, batch_ids: List[str]) -> int:
        """Undo from the top of the stack while the top is one of `batch_ids` (scene_change "Undo")."""
        count = 0
        while True:
            scene = self.get(project_id, uid)
            stack = scene.get("undoStack") or []
            if not stack or stack[-1] not in batch_ids:
                break
            self.undo(project_id, uid)
            count += 1
        return count
