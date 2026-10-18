"""Tool registry: name, JSON schema, allowed stages, handler(ctx, args).

The same handlers back the UI action buttons (POST /conversations/{id}/actions) and Gemini function
calls. AI proposes, this code validates and applies (docs/10-chat-refactor-plan.md §5.3).
"""
import logging
import math
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from ..errors import AppException
from .asset_mapper import real_dims
from .common import get_owned
from .geometry import obb_corners, obb_overlap, point_in_polygon, polygon_centroid
from .workflow import Ctx, NeedsConfirmation, Workflow

logger = logging.getLogger("api.tools")

ALL_STAGES = ["uploading", "cropping", "parsing", "reviewing_plan", "choosing_style", "resolving_missing", "scene_ready"]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


@dataclass
class ToolResult:
    data: Dict[str, Any]
    batch_id: Optional[str] = None  # scene batch this call committed
    summary: Optional[str] = None  # one line for the scene_change message


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]
    stages: List[str]
    handler: Callable[["ToolContext", Dict[str, Any]], ToolResult]
    requires_confirmation: bool = False
    agent_only: bool = False
    ui_only: bool = False

    def declaration(self) -> Dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


@dataclass
class ToolContext:
    ctx: Ctx
    workflow: Workflow
    stage: str
    scratch: Dict[str, Any] = field(default_factory=dict)

    @property
    def project_id(self) -> str:
        return self.ctx.conversation_id

    def scene(self) -> dict:
        return self.workflow.scenes.get(self.project_id, self.ctx.uid)

    def level(self) -> dict:
        return self.scene()["graph"]["levels"][0]

    def item(self, item_id: str) -> dict:
        for it in self.level()["items"]:
            if it["id"] == item_id:
                return it
        raise AppException(status_code=400, code="UNKNOWN_ITEM", detail=f"No item '{item_id}'. Use ids from the scene summary.")

    def apply(self, ops: List[dict], label: str) -> ToolResult:
        res = self.workflow.scenes.apply_batch(self.project_id, self.ctx.uid, ops, origin="agent" if self.ctx.source == "agent" else "ui", label=label)
        data = {"applied": True, "warnings": [w["message"] for w in res["warnings"]], "sceneVersion": res["newVersion"]}
        return ToolResult(data=data, batch_id=res["batchId"], summary=label)


def _obj(props: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


NUM = {"type": "number"}
STR = {"type": "string"}


# ---------------------------------------------------------------------------- stage tools

def _confirm_crop(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    return ToolResult(t.workflow.confirm_crop(t.ctx, args.get("crop")))


def _restart_crop(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    return ToolResult(t.workflow.restart_crop(t.ctx))


def _retry_parse(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    return ToolResult(t.workflow.retry_parse(t.ctx))


def _confirm_plan(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    return ToolResult(t.workflow.confirm_plan(t.ctx))


def _edit_plan(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    return ToolResult(t.workflow.edit_plan(t.ctx))


def _select_style(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    style = str(args.get("style") or "").strip().title()
    return ToolResult(t.workflow.select_style(t.ctx, style))


def _skip_missing(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    ids = [str(i) for i in args.get("componentIds") or []] or None
    # Skipping chosen boxes never builds (even the last one: the user may still Restore it); skipping all
    # remaining boxes ("Skip all" / "Skip remaining") builds the scene.
    return ToolResult(t.workflow.skip_missing(t.ctx, ids, build_when_done=ids is None))


def _continue(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    return ToolResult(t.workflow.continue_(t.ctx))


def _undo(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    scenes = t.workflow.scenes
    batch_ids = args.get("batchIds")
    if batch_ids:
        n = scenes.undo_batches(t.project_id, t.ctx.uid, list(batch_ids))
        return ToolResult({"undone": n})
    res = scenes.undo(t.project_id, t.ctx.uid)
    return ToolResult({"undone": 1, "label": res.get("label"), "sceneVersion": res["newVersion"]})


# ---------------------------------------------------------------------------- scene tools

def _clamp_dims(item: dict, dims: Dict[str, float]) -> Dict[str, float]:
    out = {}
    for k in ("w", "d", "h"):
        cur = float(item["dims"][k])
        out[k] = round(max(cur * 0.2, min(cur * 3.0, max(0.05, float(dims[k])))), 3)
    return out


def _move_item(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    it = t.item(args.get("itemId", ""))
    x, y, z = it["position"]
    if args.get("toRoomId"):
        room = next((r for r in t.level()["rooms"] if r["id"] == args["toRoomId"]), None)
        if not room:
            raise AppException(status_code=400, code="UNKNOWN_ROOM", detail=f"No room '{args['toRoomId']}'")
        x, z = _free_spot(t.level(), polygon_centroid([(p["x"], p["z"]) for p in room["polygon"]]), it, ignore=it["id"])
    x += float(args.get("dx") or 0)
    z += float(args.get("dz") or 0)
    return t.apply([{"op": "item.move", "id": it["id"], "position": [round(x, 3), y, round(z, 3)]}], f"Moved {it['label']}")


def _rotate_item(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    it = t.item(args.get("itemId", ""))
    deg = float(args.get("degrees") or 0)
    rot = it["rotationY"] - math.radians(deg)  # positive = clockwise seen from above
    return t.apply([{"op": "item.rotate", "id": it["id"], "rotationY": round(rot, 5)}], f"Rotated {it['label']} {deg:g}°")


def _resize_item(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    it = t.item(args.get("itemId", ""))
    cur = it["dims"]
    keep = args.get("keepRatio", True)
    given = {k: float(args[k]) for k in ("w", "d", "h") if args.get(k)}
    if not given:
        raise AppException(status_code=400, code="NO_DIMS", detail="Give at least one of w, d, h in meters")
    if keep:
        k0, v0 = next(iter(given.items()))
        f = v0 / float(cur[k0])
        dims = {k: float(cur[k]) * f for k in ("w", "d", "h")}
    else:
        dims = {k: given.get(k, float(cur[k])) for k in ("w", "d", "h")}
    dims = _clamp_dims(it, dims)
    return t.apply([{"op": "item.resize", "id": it["id"], "dims": dims}], f"Resized {it['label']}")


def _remove_item(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    it = t.item(args.get("itemId", ""))
    return t.apply([{"op": "item.remove", "id": it["id"]}], f"Removed {it['label']}")


def _readable_asset(t: ToolContext, asset_id: str) -> dict:
    try:
        return t.workflow.assets.get_readable(asset_id, t.ctx.uid)
    except AppException:
        raise AppException(status_code=400, code="UNKNOWN_ASSET", detail=f"No asset '{asset_id}'. Use find_assets to get ids.")


def _replace_item(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    it = t.item(args.get("itemId", ""))
    asset = _readable_asset(t, args.get("assetId", ""))
    style = t.scene()["graph"]["meta"]["style"]
    if asset.get("isSystem") and asset.get("style") not in (None, style):
        raise AppException(status_code=400, code="STYLE_MISMATCH", detail=f"Pick a {style} asset or one of the user's own")
    return t.apply([{"op": "item.replace", "id": it["id"], "assetId": asset["id"]}], f"Replaced {it['label']} with {asset['name']}")


def _footprint(item: dict, x: float, z: float):
    return obb_corners((x, z), item["dims"]["w"], item["dims"]["d"], item.get("rotationY", 0.0))


def _free_spot(level: dict, start, item: dict, ignore: Optional[str] = None):
    """Nearest collision-free position to `start` on a 15 cm spiral (falls back to start)."""
    others = [o for o in level["items"] if o["id"] != ignore]
    for ring in range(0, 25):
        r = ring * 0.15
        steps = 1 if ring == 0 else 8 * ring
        for s in range(steps):
            a = 2 * math.pi * s / steps
            x, z = start[0] + r * math.cos(a), start[1] + r * math.sin(a)
            mine = _footprint(item, x, z)
            if not any(obb_overlap(mine, _footprint(o, o["position"][0], o["position"][2])) for o in others):
                return round(x, 3), round(z, 3)
    return start


def _add_item(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    asset = _readable_asset(t, args.get("assetId", ""))
    level = t.level()
    room = next((r for r in level["rooms"] if r["id"] == args.get("roomId")), None)
    near = next((i for i in level["items"] if i["id"] == args.get("near")), None) if args.get("near") else None
    dims = real_dims(asset, asset.get("category"))
    item = {
        "id": f"itm_ai_{t.workflow.db.collection('scenes').document().id[:8]}",
        "assetId": asset["id"],
        "componentId": None,
        "label": args.get("label") or asset.get("name") or "Item",
        "category": asset.get("category"),
        "roomId": room["id"] if room else None,
        "position": [0.0, 0.0, 0.0],
        "rotationY": 0.0,
        "dims": dims,
        "scaleMode": "uniform",
        "addedBy": "agent",
    }
    if near:
        start = (near["position"][0] + near["dims"]["w"] / 2 + dims["w"] / 2 + 0.1, near["position"][2])
        item["roomId"] = item["roomId"] or near.get("roomId")
    elif room:
        start = polygon_centroid([(p["x"], p["z"]) for p in room["polygon"]])
    else:
        b = t.scene()["graph"]["meta"]["bounds"]
        start = ((b["minX"] + b["maxX"]) / 2, (b["minZ"] + b["maxZ"]) / 2)
    x, z = _free_spot(level, start, item)
    item["position"] = [x, 0.0, z]
    if not item["roomId"]:
        item["roomId"] = next((r["id"] for r in level["rooms"] if point_in_polygon((x, z), [(p["x"], p["z"]) for p in r["polygon"]])), None)
    res = t.apply([{"op": "item.add", "item": item}], f"Added {item['label']}")
    res.data["itemId"] = item["id"]
    return res


def _hex(args: Dict[str, Any]) -> str:
    h = str(args.get("hex") or "")
    if not HEX.match(h):
        raise AppException(status_code=400, code="INVALID_COLOR", detail="hex must look like #A1B2C3")
    return h.upper()


def _set_wall_color(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    hexv = _hex(args)
    ids = args.get("wallIds") or []
    ops = [{"op": "surface.material", "target": {"wallId": i}, "material": {"tint": hexv}} for i in ids] or [
        {"op": "surface.material", "target": {"allWalls": True}, "material": {"tint": hexv}}
    ]
    return t.apply(ops, f"Wall color {hexv}")


def _set_floor_color(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    hexv = _hex(args)
    ids = args.get("roomIds") or []
    ops = [{"op": "surface.material", "target": {"roomId": i}, "material": {"tint": hexv}} for i in ids] or [
        {"op": "surface.material", "target": {"allFloors": True}, "material": {"tint": hexv}}
    ]
    return t.apply(ops, f"Floor color {hexv}")


def _scale_mapped_item(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    project = get_owned(t.workflow.db, "projects", t.project_id, t.ctx.uid)
    cid = args.get("componentId", "")
    entry = (project.get("mapping") or {}).get(cid)
    if not entry or not entry.get("assetId"):
        raise AppException(status_code=400, code="UNKNOWN_COMPONENT", detail=f"No matched object '{cid}'")
    cur = entry.get("dims") or entry.get("autoDims")
    if not cur:
        raise AppException(status_code=409, code="NO_DIMS_YET", detail="This model is still being generated")
    if args.get("percent"):
        base = entry.get("autoDims") or cur
        f = float(args["percent"]) / 100.0
        dims = {k: base[k] * f for k in ("w", "d", "h")}
    else:
        given = {k: float(args[k]) for k in ("w", "d", "h") if args.get(k)}
        if not given:
            raise AppException(status_code=400, code="NO_DIMS", detail="Give percent or one of w, d, h in meters")
        if args.get("keepRatio", True):
            k0, v0 = next(iter(given.items()))
            dims = {k: cur[k] * v0 / cur[k0] for k in ("w", "d", "h")}
        else:
            dims = {k: given.get(k, cur[k]) for k in ("w", "d", "h")}
    dims = {k: round(max(0.05, min(10.0, v)), 3) for k, v in dims.items()}
    t.workflow.update_mapping(t.project_id, t.ctx.uid, cid, dims, None, bool(args.get("applyToSameAsset", True)), False)
    return ToolResult({"applied": True, "dims": dims})


def _find_assets(t: ToolContext, args: Dict[str, Any]) -> ToolResult:
    q = str(args.get("query") or "").lower().strip()
    style = args.get("style")
    words = [w for w in re.split(r"\W+", q) if w]
    try:  # so "another sofa" does not pick the one already there
        in_scene = {i.get("assetId") for i in t.level()["items"]} if t.stage == "scene_ready" else set()
    except AppException:
        in_scene = set()
    out = []
    for a in t.workflow.assets.placeable_assets(t.ctx.uid):
        if a.get("status", "ready") != "ready":
            continue
        if style and a.get("isSystem") and a.get("style") != style:
            continue
        hay = f"{a.get('name', '')} {a.get('category', '')} {a.get('style') or ''}".lower()
        if not words or all(w in hay for w in words) or any(w in hay for w in words if len(w) > 3):
            out.append({"assetId": a["id"], "name": a.get("name"), "category": a.get("category"), "style": a.get("style"),
                        "owner": "system" if a.get("isSystem") else "user", "inScene": a["id"] in in_scene})
    return ToolResult({"results": out[:15], "count": len(out)})


# ---------------------------------------------------------------------------- registry

TOOLS: Dict[str, ToolSpec] = {}


def _register(spec: ToolSpec) -> None:
    TOOLS[spec.name] = spec


_register(ToolSpec("confirm_crop", "Crop the floor plan with the crop rectangle the user set on the canvas and start reading the plan. "
                   "Use when the user says the crop is done/good.", _obj({}), ["cropping"], _confirm_crop))
_register(ToolSpec("restart_crop", "Go back to cropping the original upload (discards the parsed plan). Destructive: ask first.",
                   _obj({}), ["parsing", "reviewing_plan", "choosing_style", "resolving_missing", "scene_ready"], _restart_crop,
                   requires_confirmation=True))
_register(ToolSpec("retry_parse", "Read the cropped plan again after a failed attempt.", _obj({}), ["cropping"], _retry_parse))
_register(ToolSpec("confirm_plan", "The user approved the 2D plan; move on to choosing a style.", _obj({}), ["reviewing_plan"], _confirm_plan))
_register(ToolSpec("edit_plan", "Go back to the 2D plan editor. From the 3D stage this rebuilds the scene: ask first.", _obj({}),
                   ["choosing_style", "resolving_missing", "scene_ready"], _edit_plan, requires_confirmation=True))
_register(ToolSpec("select_style", "Apply an interior style: places catalog furniture into the plan. From the 3D stage it rebuilds "
                   "the scene: ask first there.", _obj({"style": {"type": "string", "enum": ["Industrial", "Japandi"]}}, ["style"]),
                   ["choosing_style", "resolving_missing", "scene_ready"], _select_style))
_register(ToolSpec("skip_missing", "Skip plan objects that have no 3D model. With componentIds: skip (delete) just those, even "
                   "matched ones (the scene is not built yet). Without: skip all remaining ones and build the 3D scene.", _obj({"componentIds": {"type": "array", "items": STR}}),
                   ["resolving_missing"], _skip_missing))
_register(ToolSpec("continue", "Continue to 3D (objects still without a model are skipped).", _obj({}), ["resolving_missing"],
                   _continue, ui_only=True))
_register(ToolSpec("scale_mapped_item", "Rescale the 3D model placed in a plan box before the scene is built. Sizes in meters "
                   "(w = width, d = depth, h = height) or percent of the automatic fit.",
                   _obj({"componentId": STR, "w": NUM, "d": NUM, "h": NUM, "percent": NUM,
                         "keepRatio": {"type": "boolean"}, "applyToSameAsset": {"type": "boolean"}}, ["componentId"]),
                   ["resolving_missing"], _scale_mapped_item))
_register(ToolSpec("move_item", "Move a furniture item on the floor. dx = +right/-left, dz = +down/-up as seen on the plan "
                   "(meters), or toRoomId to move it into another room.",
                   _obj({"itemId": STR, "dx": NUM, "dz": NUM, "toRoomId": STR}, ["itemId"]), ["scene_ready"], _move_item))
_register(ToolSpec("rotate_item", "Rotate an item by degrees, positive = clockwise seen from above.",
                   _obj({"itemId": STR, "degrees": NUM}, ["itemId", "degrees"]), ["scene_ready"], _rotate_item))
_register(ToolSpec("resize_item", "Resize an item (meters). keepRatio (default true) scales all sides from the first given one.",
                   _obj({"itemId": STR, "w": NUM, "d": NUM, "h": NUM, "keepRatio": {"type": "boolean"}}, ["itemId"]),
                   ["scene_ready"], _resize_item))
_register(ToolSpec("remove_item", "Delete an item from the scene. Destructive: ask first.", _obj({"itemId": STR}, ["itemId"]),
                   ["scene_ready"], _remove_item, requires_confirmation=True))
_register(ToolSpec("replace_item", "Swap an item's 3D model for another asset (same style or the user's own), keeping its place.",
                   _obj({"itemId": STR, "assetId": STR}, ["itemId", "assetId"]), ["scene_ready"], _replace_item))
_register(ToolSpec("add_item", "Add an asset to a room (at its center or beside the `near` item), avoiding collisions.",
                   _obj({"assetId": STR, "roomId": STR, "near": STR, "label": STR}, ["assetId"]), ["scene_ready"], _add_item))
_register(ToolSpec("set_wall_color", "Paint walls (all walls when wallIds is empty).",
                   _obj({"hex": STR, "wallIds": {"type": "array", "items": STR}}, ["hex"]), ["scene_ready"], _set_wall_color))
_register(ToolSpec("set_floor_color", "Change floor color (all floors when roomIds is empty).",
                   _obj({"hex": STR, "roomIds": {"type": "array", "items": STR}}, ["hex"]), ["scene_ready"], _set_floor_color))
_register(ToolSpec("undo_last_change", "Undo the last change to the 3D scene (the user's or yours).", _obj({}), ["scene_ready"], _undo))
_register(ToolSpec("find_assets", "Search the furniture library (name/category). Returns asset ids for add_item / replace_item.",
                   _obj({"query": STR, "style": {"type": "string", "enum": ["Industrial", "Japandi"]}}, ["query"]),
                   ALL_STAGES, _find_assets))


def tools_for_stage(stage: str) -> List[ToolSpec]:
    return [t for t in TOOLS.values() if stage in t.stages and not t.ui_only]


def run_tool(name: str, args: Dict[str, Any], tctx: ToolContext) -> ToolResult:
    """Validate stage + confirmation, then run. Raises AppException with a readable detail."""
    spec = TOOLS.get(name)
    if not spec:
        raise AppException(status_code=400, code="UNKNOWN_TOOL", detail=f"Unknown action '{name}'")
    if tctx.stage not in spec.stages:
        raise AppException(status_code=409, code="WRONG_STAGE",
                           detail=f"'{name}' is not available in stage '{tctx.stage}'")
    if spec.requires_confirmation and not tctx.ctx.user_confirmed:
        raise NeedsConfirmation(spec.description)
    return spec.handler(tctx, args or {})
