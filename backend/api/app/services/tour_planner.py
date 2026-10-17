"""AI director for the cinematic tour (web/src/canvas/Scene3D/cinematic.ts).

The browser computes candidate shots per room with a visibility analysis (camera spots clear of walls and
furniture, aimed where the room's furniture is in view) and renders a small preview of each. Gemini looks at the
previews and the house summary and *chooses*: which rooms to show, in which walkthrough order, which candidate
(s) per room and which camera move. It never invents coordinates, so every shot it returns is physically valid;
this module validates the answer before it reaches the browser (AI proposes, deterministic code applies).
"""
import base64
import binascii
import json
import logging
from typing import Any, Dict, List

from ..errors import AppException
from .common import get_owned

logger = logging.getLogger("api.tour")

MOVES = ("dolly_in", "dolly_out", "slide_left", "slide_right", "pan_left", "pan_right", "drift")
MIN_S, MAX_S = 3.5, 7.0
MAX_TOTAL_S = 75.0
MAX_PER_ROOM = 2

SYSTEM = """You are the director of a short cinematic real-estate walkthrough video of a 3D home.

You receive the rooms of the home and, for each room, a few candidate camera shots. Every candidate comes with a
preview image (the first frame of the shot, camera at eye height) and a description. Pick the shots for the video.

Rules:
- Judge the previews. Reject shots that mostly show a blank wall, a close-up of the side of a cabinet or fridge,
  an empty corner, a doorway into another room, or that cut furniture awkwardly. Prefer shots that show the
  room's character: its main furniture, depth (two or more walls), and a clear composition.
- One shot per room. Use a second, clearly different angle only for the most important spaces (living room,
  kitchen, master bedroom) and only when both previews are good.
- Skip rooms whose candidates are all poor, and skip corridors, halls, foyers and closets unless a preview is
  genuinely attractive.
- Order the shots as a natural walkthrough: living spaces first (living, dining, kitchen), then bedrooms, then
  bathrooms. Follow door connections when given, so the viewer moves between neighbouring rooms.
- Choose one camera move per shot:
  dolly_in (slow push forward, reveals depth; good for rooms seen from a corner),
  dolly_out (slow pull back, reveals the room),
  slide_left / slide_right (sideways truck, parallax along furniture such as a sofa, bed or kitchen counter),
  pan_left / pan_right (slow turn on the spot; wide rooms),
  drift (almost static; small rooms such as bathrooms).
  Vary the moves from shot to shot.
- Duration per shot 4 to 6 seconds (small rooms 4, large or important rooms 5 to 6). Keep the total of all your
  shots between 25 and 60 seconds.

Answer with JSON only:
{"shots": [{"candidateId": "<id from the list>", "move": "<one of the moves>", "duration": <seconds>, "reason": "<short>"}]}
"""


def _decode_image(data: str) -> bytes:
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise AppException(status_code=400, code="INVALID_IMAGE", detail="Candidate previews must be base64 JPEG")


def build_parts(req: Dict[str, Any]) -> List[Any]:
    """Prompt as an ordered list of text and (bytes, mime) image parts."""
    rooms = req["rooms"]
    names = {r["id"]: r["name"] for r in rooms}
    lines = [f"Home: {req.get('title') or 'Home'}" + (f" ({req['style']} style)" if req.get("style") else ""), "", "Rooms:"]
    for r in rooms:
        conn = ", ".join(names.get(c, c) for c in r.get("connectsTo") or [])
        items = ", ".join((r.get("items") or [])[:20]) or "no furniture"
        lines.append(f"- {r['name']} (id {r['id']}, {r.get('type') or 'room'}, {r.get('area', 0):.0f} m²): {items}"
                     + (f"; doors to {conn}" if conn else ""))
    lines += ["", "Candidate shots (preview image follows each description):"]
    parts: List[Any] = ["\n".join(lines)]
    for c in req["candidates"]:
        parts.append(f"\nCandidate {c['id']} (room {names.get(c['roomId'], c['roomId'])}, visibility score "
                     f"{c.get('score', 0):.2f}): {c.get('description', '')}")
        if c.get("image"):
            parts.append((_decode_image(c["image"]), "image/jpeg"))
    parts.append("\nNow choose the shots. JSON only.")
    return parts


def validate(raw: Any, req: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Keep only well-formed shots on known candidates; clamp durations; cap per room and in total."""
    room_of = {c["id"]: c["roomId"] for c in req["candidates"]}
    shots = raw.get("shots") if isinstance(raw, dict) else raw
    out: List[Dict[str, Any]] = []
    per_room: Dict[str, int] = {}
    used = set()
    total = 0.0
    for s in shots if isinstance(shots, list) else []:
        if not isinstance(s, dict):
            continue
        cid = s.get("candidateId")
        if cid not in room_of or cid in used:
            continue
        room = room_of[cid]
        if per_room.get(room, 0) >= MAX_PER_ROOM:
            continue
        move = s.get("move") if s.get("move") in MOVES else "drift"
        try:
            duration = float(s.get("duration") or 5)
        except (TypeError, ValueError):
            duration = 5.0
        duration = min(MAX_S, max(MIN_S, duration))
        if total + duration > MAX_TOTAL_S:
            break
        used.add(cid)
        per_room[room] = per_room.get(room, 0) + 1
        total += duration
        out.append({"candidateId": cid, "move": move, "duration": round(duration, 2), "reason": str(s.get("reason") or "")[:200]})
    return out


class TourPlanner:
    def __init__(self, db, gemini):
        self.db = db
        self.gemini = gemini

    def plan(self, project_id: str, uid: str, req: Dict[str, Any]) -> Dict[str, Any]:
        get_owned(self.db, "projects", project_id, uid)
        if not req.get("candidates"):
            raise AppException(status_code=400, code="NO_CANDIDATES", detail="No candidate shots to choose from")
        parts = build_parts(req)
        try:
            text = self.gemini.direct_tour(SYSTEM, parts)
            raw = json.loads(text or "{}")
        except AppException:
            raise
        except Exception as e:  # the browser falls back to its automatic plan
            logger.warning("Tour planning failed: %s", e)
            raise AppException(status_code=502, code="TOUR_PLANNING_FAILED", detail="The AI director is unavailable")
        shots = validate(raw, req)
        if not shots:
            raise AppException(status_code=502, code="TOUR_PLANNING_FAILED", detail="The AI director returned no usable shots")
        logger.info(json.dumps({"event": "tour_planned", "project": project_id, "candidates": len(req["candidates"]),
                                "shots": len(shots)}))
        return {"shots": shots, "source": "gemini"}

