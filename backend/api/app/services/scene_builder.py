"""FloorPlan + style + mapping → SceneGraph v1 subset (docs/10-chat-refactor-plan.md §4.2, §5.5).

Deterministic and pure. Plan (x, y) with y down → scene (x, z) with y up: X = x·k, Z = y·k.
"""
import math
import re
from typing import Any, Dict, List

from .asset_mapper import box_center, plan_boxes
from .common import load_styles
from .geometry import (
    closest_point_on_segment,
    distance_to_segment,
    plan_scale,
    point_in_polygon,
    polygon_area,
)

WALL_HEIGHT_M = 2.7
DOOR_HEIGHT_M = 2.1
WINDOW_HEIGHT_M = 1.2
WINDOW_SILL_M = 0.9
MIN_WALL_T, MAX_WALL_T = 0.08, 0.3

ROOM_TYPES = [
    ("bathroom", r"bath|wc|toilet|powder|ensuite|shower|restroom"),
    ("kitchen", r"kitchen|pantry|galley"),
    ("bedroom", r"bed|master|guest|nursery"),
    ("dining", r"dining"),
    ("living", r"living|lounge|family|great room|sitting"),
    ("office", r"office|study|den|library"),
    ("hallway", r"hall|corridor|entry|foyer|lobby|landing"),
    ("balcony", r"balcony|terrace|deck|patio|porch"),
]


def room_type(name: str) -> str:
    n = (name or "").lower()
    for t, pattern in ROOM_TYPES:
        if re.search(pattern, n):
            return t
    return "other"


def _r(v: float) -> float:
    return round(float(v), 4)


def build_scene(
    project_id: str,
    plan: dict,
    style: str,
    mapping: Dict[str, dict],
    version: int = 1,
) -> Dict[str, Any]:
    k = plan_scale(plan)
    styles = load_styles()
    palette = dict((styles.get(style) or next(iter(styles.values())))["palette"])

    walls: List[dict] = []
    for i, w in enumerate(plan.get("walls") or []):
        start = (float(w["x1"]) * k, float(w["y1"]) * k)
        end = (float(w["x2"]) * k, float(w["y2"]) * k)
        if math.hypot(end[0] - start[0], end[1] - start[1]) < 0.05:
            continue
        t = float(w.get("thickness") or 0.5) * k
        walls.append({
            "id": w.get("id") or f"wal_{i + 1:03d}",
            "start": [_r(start[0]), _r(start[1])],
            "end": [_r(end[0]), _r(end[1])],
            "thickness": _r(min(MAX_WALL_T, max(MIN_WALL_T, t))),
            "height": WALL_HEIGHT_M,
            "exterior": bool(w.get("exterior")),
            "color": None,
        })

    openings: List[dict] = []
    for kind, key in (("door", "doors"), ("window", "windows")):
        for i, o in enumerate(plan.get(key) or []):
            p = (float(o["x"]) * k, float(o["y"]) * k)
            wall = next((wl for wl in walls if wl["id"] == o.get("wallId")), None)
            if wall is None and walls:
                wall = min(walls, key=lambda wl: distance_to_segment(p, tuple(wl["start"]), tuple(wl["end"])))
                if distance_to_segment(p, tuple(wall["start"]), tuple(wall["end"])) > wall["thickness"] + 0.5:
                    wall = None
            if wall is None:
                continue
            a, b = tuple(wall["start"]), tuple(wall["end"])
            _, t = closest_point_on_segment(p, a, b)
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            width = min(float(o.get("width") or 3) * k, length)
            openings.append({
                "id": o.get("id") or f"opn_{kind}_{i + 1:03d}",
                "wallId": wall["id"],
                "type": kind,
                "offset": _r(t * length),
                "width": _r(width),
                "height": DOOR_HEIGHT_M if kind == "door" else WINDOW_HEIGHT_M,
                "sillHeight": 0.0 if kind == "door" else WINDOW_SILL_M,
            })

    rooms: List[dict] = []
    room_polys: Dict[str, List[tuple]] = {}
    for i, r in enumerate(plan.get("rooms") or []):
        poly = [(float(p["x"]) * k, float(p["y"]) * k) for p in r.get("polygon") or []]
        if len(poly) < 3:
            continue
        rid = r.get("id") or f"rom_{i + 1:03d}"
        room_polys[rid] = poly
        rooms.append({
            "id": rid,
            "name": r.get("name") or f"Room {i + 1}",
            "type": room_type(r.get("name") or ""),
            "polygon": [{"x": _r(x), "z": _r(z)} for x, z in poly],
            "area": round(polygon_area(poly), 2),
            "floorColor": None,
        })

    items: List[dict] = []
    for b in plan_boxes(plan):
        entry = mapping.get(b["id"])
        if not entry or entry.get("skipped") or not entry.get("assetId"):
            continue
        cx, cy = box_center(b)
        center = (cx * k, cy * k)
        dims = entry.get("dims") or {"w": float(b["width"]) * k, "d": float(b["height"]) * k, "h": 0.8}
        room_id = next((rid for rid, poly in room_polys.items() if point_in_polygon(center, poly)), None)
        items.append({
            "id": f"itm_{b['id']}",
            "assetId": entry["assetId"],
            "componentId": b["id"],
            "label": entry.get("label") or b.get("label") or "Item",
            "category": entry.get("category"),
            "roomId": room_id,
            "position": [_r(center[0]), 0.0, _r(center[1])],
            "rotationY": _r(-math.radians(float(b.get("rotation") or 0)) + float(entry.get("rotationOffset") or 0)),
            "dims": {"w": _r(dims["w"]), "d": _r(dims["d"]), "h": _r(dims["h"])},
            "scaleMode": "uniform",
            "addedBy": "parser",
        })

    xs = [0.0, float(plan.get("width") or 0) * k] + [c for wl in walls for c in (wl["start"][0], wl["end"][0])]
    zs = [0.0, float(plan.get("height") or 0) * k] + [c for wl in walls for c in (wl["start"][1], wl["end"][1])]
    bounds = {"minX": _r(min(xs)), "minZ": _r(min(zs)), "maxX": _r(max(xs)), "maxZ": _r(max(zs))}

    return {
        "schemaVersion": "1.0",
        "id": f"scn_{project_id}",
        "projectId": project_id,
        "version": version,
        "units": "m",
        "meta": {"style": style, "palette": palette, "bounds": bounds},
        "levels": [{
            "id": "lvl_0",
            "name": "Ground floor",
            "elevation": 0.0,
            "ceilingHeight": WALL_HEIGHT_M,
            "walls": walls,
            "openings": openings,
            "rooms": rooms,
            "items": items,
        }],
    }


def scene_summary_stats(graph: Dict[str, Any]) -> Dict[str, int]:
    level = (graph.get("levels") or [{}])[0]
    return {"rooms": len(level.get("rooms") or []), "walls": len(level.get("walls") or []), "items": len(level.get("items") or [])}
