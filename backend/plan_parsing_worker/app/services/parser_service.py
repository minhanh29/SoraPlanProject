import base64
import io
import json
import logging
import math
import re
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional
import httpx
import importlib

try:
    Image = importlib.import_module("PIL.Image")
    HAS_PIL = True
except Exception:
    Image = None  # type: ignore
    HAS_PIL = False

from firebase_admin import firestore

from ..config import get_settings
from ..firebase import get_firestore_client, get_storage_client
from ..models.floorplan import (
    Door,
    Fixture,
    FloorPlan,
    Furniture,
    Point2D,
    Room,
    RoomCorners,
    SourceImage,
    StatedDimensions,
    Wall,
    Window,
)
from ..models.task import ParsePlanTaskRequest

logger = logging.getLogger("plan_parsing_worker.service")

SYSTEM_INSTRUCTION = """You are an architectural floor-plan digitisation engine.
Analyse the supplied floor-plan image and reconstruct its editable 2D geometry as structured JSON.
Your job is not to describe the image. Your job is to convert every meaningful architectural component into structured geometry.

1. WALLS & EXTERIOR BOUNDARY (OUTSIDE THE ROOM):
- Detect and add all outer perimeter walls that run around the exterior of the room / building footprint ("exterior": true), as well as all interior partition walls ("exterior": false).
- The outer boundary walls framing the outside of the room MUST be included so the room perimeter is clearly established.

2. WINDOWS AND DOORS (BLANK GAPS BETWEEN WALLS):
- IMPORTANT: Do NOT detect, parse, or create separate objects for doors or windows (do NOT output "doors" or "windows" arrays).
- For the places of windows and doors, LET IT BE THE BLANK BETWEEN THE WALL.
- Whenever a wall (exterior or interior) contains a window or door opening, SPLIT the wall into separate individual wall segments before and after the opening.
- The space where each window or door is located must be left as an open blank gap between the wall segments (e.g. Wall Segment A -> blank space where window/door is -> Wall Segment B).
- Do NOT draw a single solid wall continuously across window or door openings. Every window and door location must remain an open blank gap between adjacent wall segments.

3. PHYSICAL OBJECTS & LABELS:
- Detect rooms, furniture, appliances, plumbing fixtures, counters, cabinets and other visible floor-plan objects.
- Preserve relative position, orientation and size.
- Furniture and fixtures must preserve approximately the same aspect ratio as shown in the floor plan.
- When explicit measurements are visible (e.g. 40' x 30', 9' x 12', etc.), use them to derive a real-world coordinate system in feet (units: "ft") or meters (units: "m"). All returned objects must use the same coordinate system.
- Use the top-left of the building footprint as origin (0, 0), with X increasing to the right and Y increasing downward.
- Walls should be represented as editable line segments with thickness (x1, y1, x2, y2, thickness, exterior).
- Do NOT include dimension arrows, annotation lines, decorative text or the 'FLOOR PLAN' title as physical objects.
- Room labels should become room metadata.
- If an object is uncertain, include it with a lower confidence score.

Return ONLY a valid JSON object matching this exact schema:
{
  "id": "fp_001",
  "units": "ft" or "m",
  "width": <number>,
  "height": <number>,
  "sourceImage": { "width": <image_px_width>, "height": <image_px_height> },
  "scaleConfidence": <number 0-1>,
  "rooms": [
    {
      "id": "rom_...",
      "name": "...",
      "polygon": [{"x": <number>, "y": <number>}, ...],
      "statedDimensions": {"width": <number>, "height": <number>},
      "confidence": <number>
    }
  ],
  "walls": [
    {
      "id": "wall_...",
      "type": "wall",
      "x1": <number>,
      "y1": <number>,
      "x2": <number>,
      "y2": <number>,
      "thickness": <number>,
      "exterior": true/false,
      "confidence": <number>
    }
  ],
  "furniture": [
    {
      "id": "fur_...",
      "type": "furniture",
      "furnitureType": "bed" | "sofa" | "chair" | "armchair" | "table" | "coffee_table" | "dining_table" | "desk" | "nightstand" | "wardrobe" | "cabinet" | "kitchen_island" | "unknown",
      "label": "...",
      "x": <number>,
      "y": <number>,
      "width": <number>,
      "height": <number>,
      "rotation": <degrees 0-360>,
      "confidence": <number>
    }
  ],
  "fixtures": [
    {
      "id": "fix_...",
      "type": "fixture",
      "fixtureType": "sink" | "toilet" | "bathtub" | "shower" | "stove" | "oven" | "refrigerator" | "washer" | "dryer" | "counter" | "unknown",
      "label": "...",
      "x": <number>,
      "y": <number>,
      "width": <number>,
      "height": <number>,
      "rotation": <degrees 0-360>,
      "confidence": <number>
    }
  ]
}
"""

CORNER_DETECTION_INSTRUCTION = """You are an architectural vision system specializing in floor plan geometric calibration.
Your task is to detect the exact four outer corners (angles) of the main building / room footprint in this floor plan image.
Rules:
1. Ignore outer margins, outside dimension lines/arrows (e.g. 40'-0", 30'-0"), title blocks, legends, and bottom labels like 'FLOOR PLAN'.
2. Identify the outermost physical exterior wall corners defining the main room or building envelope:
   - topLeft: (x, y in pixels)
   - topRight: (x, y in pixels)
   - bottomRight: (x, y in pixels)
   - bottomLeft: (x, y in pixels)
3. Calculate the tight crop bounding box around these four corners:
   - x: minimum pixel X
   - y: minimum pixel Y
   - width: pixel width (topRight.x - topLeft.x)
   - height: pixel height (bottomLeft.y - topLeft.y)
4. Read any explicit dimension annotations specifying the overall width and height of this room/building (e.g. 40 ft x 30 ft, or meters). If no text is visible, estimate real-world dimensions using standard residential scale (e.g. 40 x 30 ft).
5. Return ONLY a valid JSON object matching this schema:
{
  "imageWidth": <image_px_width>,
  "imageHeight": <image_px_height>,
  "corners": {
    "topLeft": {"x": <number>, "y": <number>},
    "topRight": {"x": <number>, "y": <number>},
    "bottomRight": {"x": <number>, "y": <number>},
    "bottomLeft": {"x": <number>, "y": <number>}
  },
  "crop": {
    "x": <number>,
    "y": <number>,
    "width": <number>,
    "height": <number>
  },
  "statedDimensions": {
    "width": <number>,
    "height": <number>,
    "units": "ft" or "m"
  },
  "confidence": <number between 0 and 1>
}
"""


class PlanParserService:
    """Service to parse floor plan images with OpenAI gpt-6-sol and normalize geometry."""

    def __init__(self):
        self.settings = get_settings()

    def detect_room_corners(self, image_bytes: bytes, mime_type: str = "image/png") -> RoomCorners:
        """Step 1 (Pre-parsing Step): Detect 4 exact corners of room footprint & physical scale."""
        # 1. Analyze image dimensions
        img_w, img_h = 2048, 1536
        if HAS_PIL and Image:
            try:
                pil_img = Image.open(io.BytesIO(image_bytes))
                img_w, img_h = pil_img.size
            except Exception as e:
                logger.warning("Could not inspect image dimensions: %s", e)

        # Normalize media type
        if "png" in mime_type.lower():
            media_type = "image/png"
        elif "jpeg" in mime_type.lower() or "jpg" in mime_type.lower():
            media_type = "image/jpeg"
        elif "webp" in mime_type.lower():
            media_type = "image/webp"
        else:
            media_type = "image/png"

        b64_data = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{media_type};base64,{b64_data}"

        instruction = CORNER_DETECTION_INSTRUCTION.replace("<image_px_width>", str(img_w)).replace("<image_px_height>", str(img_h))

        payload = {
            "model": self.settings.OPENAI_MODEL,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": instruction},
                        {"type": "input_image", "image_url": data_uri},
                    ],
                }
            ],
        }

        headers = {
            "Authorization": f"Bearer {self.settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        logger.info("Step 1: Calling OpenAI Responses API to detect 4 room angles...")
        req = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            headers=headers,
            data=json.dumps(payload).encode("utf-8"),
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                res = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            logger.error("Failed to detect room corners with OpenAI: %s", e)
            crop_w = int(img_w * 0.75)
            crop_h = int(img_h * 0.75)
            crop_x = int((img_w - crop_w) / 2)
            crop_y = int((img_h - crop_h) / 2)
            return RoomCorners(
                topLeft=Point2D(x=crop_x, y=crop_y),
                topRight=Point2D(x=crop_x + crop_w, y=crop_y),
                bottomRight=Point2D(x=crop_x + crop_w, y=crop_y + crop_h),
                bottomLeft=Point2D(x=crop_x, y=crop_y + crop_h),
                cropX=crop_x,
                cropY=crop_y,
                cropWidth=crop_w,
                cropHeight=crop_h,
                planWidth=40.0,
                planHeight=30.0,
                units="ft",
                confidence=0.5,
            )

        raw_text = ""
        for item in res.get("output", []):
            if item.get("type") == "message":
                for c in item.get("content", []):
                    if c.get("type") == "output_text":
                        raw_text = c.get("text", "")
                        break
            if raw_text:
                break

        data = self._extract_json(raw_text)
        corners_data = data.get("corners", {})
        crop_data = data.get("crop", {})
        stated = data.get("statedDimensions", {})

        tl = corners_data.get("topLeft", {})
        tr = corners_data.get("topRight", {})
        br = corners_data.get("bottomRight", {})
        bl = corners_data.get("bottomLeft", {})

        tl_pt = Point2D(x=float(tl.get("x", 0)), y=float(tl.get("y", 0)))
        tr_pt = Point2D(x=float(tr.get("x", img_w)), y=float(tr.get("y", 0)))
        br_pt = Point2D(x=float(br.get("x", img_w)), y=float(br.get("y", img_h)))
        bl_pt = Point2D(x=float(bl.get("x", 0)), y=float(bl.get("y", img_h)))

        crop_x = float(crop_data.get("x", min(tl_pt.x, bl_pt.x)))
        crop_y = float(crop_data.get("y", min(tl_pt.y, tr_pt.y)))
        crop_w = float(crop_data.get("width", max(tr_pt.x, br_pt.x) - crop_x))
        crop_h = float(crop_data.get("height", max(bl_pt.y, br_pt.y) - crop_y))

        plan_w = float(stated.get("width") or 40.0)
        plan_h = float(stated.get("height") or 30.0)
        units = str(stated.get("units") or "ft")
        conf = float(data.get("confidence") or 0.95)

        logger.info(
            "Detected 4 room angles: TL=(%d,%d), TR=(%d,%d), BR=(%d,%d), BL=(%d,%d) -> Crop=(%d,%d,%d,%d), Stated Size=%.1fx%.1f %s",
            tl_pt.x, tl_pt.y, tr_pt.x, tr_pt.y, br_pt.x, br_pt.y, bl_pt.x, bl_pt.y,
            crop_x, crop_y, crop_w, crop_h, plan_w, plan_h, units,
        )

        return RoomCorners(
            topLeft=tl_pt,
            topRight=tr_pt,
            bottomRight=br_pt,
            bottomLeft=bl_pt,
            cropX=crop_x,
            cropY=crop_y,
            cropWidth=crop_w,
            cropHeight=crop_h,
            planWidth=plan_w,
            planHeight=plan_h,
            units="m" if units == "m" else "ft",
            confidence=max(0.0, min(1.0, conf)),
        )

    def parse_image_bytes(
        self,
        image_bytes: bytes,
        mime_type: str = "image/png",
        room_corners: Optional[RoomCorners] = None,
    ) -> FloorPlan:
        """Call OpenAI Responses API with gpt-6-sol and parse floor plan image, calibrated to room footprint."""
        # 1. Analyze input image dimensions with PIL if available
        img_w, img_h = 2048, 1536
        if HAS_PIL and Image:
            try:
                pil_img = Image.open(io.BytesIO(image_bytes))
                img_w, img_h = pil_img.size
                img_format = pil_img.format or "PNG"
                logger.info("Loaded floor plan image: %dx%d (%s, %d bytes)", img_w, img_h, img_format, len(image_bytes))
            except Exception as e:
                logger.warning("Could not inspect image with PIL: %s", e)
                img_w, img_h = 2048, 1536

        # Normalize MIME type
        if "png" in mime_type.lower():
            media_type = "image/png"
        elif "jpeg" in mime_type.lower() or "jpg" in mime_type.lower():
            media_type = "image/jpeg"
        elif "webp" in mime_type.lower():
            media_type = "image/webp"
        else:
            media_type = "image/png"

        # 2. Encode to Base64
        b64_data = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{media_type};base64,{b64_data}"

        # 3. Formulate calibrated system instruction
        active_instruction = SYSTEM_INSTRUCTION
        if room_corners:
            active_instruction += f"""
CRITICAL PRE-CALIBRATED ROOM BOUNDARY CONSTRAINTS:
The exact four outer corners (angles) of this room/building footprint have been detected:
- Top-Left Corner: ({room_corners.topLeft.x:.0f}, {room_corners.topLeft.y:.0f}) pixels
- Top-Right Corner: ({room_corners.topRight.x:.0f}, {room_corners.topRight.y:.0f}) pixels
- Bottom-Right Corner: ({room_corners.bottomRight.x:.0f}, {room_corners.bottomRight.y:.0f}) pixels
- Bottom-Left Corner: ({room_corners.bottomLeft.x:.0f}, {room_corners.bottomLeft.y:.0f}) pixels
- Room Crop Region: x={room_corners.cropX:.0f}, y={room_corners.cropY:.0f}, width={room_corners.cropWidth:.0f}, height={room_corners.cropHeight:.0f} pixels
- Real-World Room Dimensions: {room_corners.planWidth} x {room_corners.planHeight} {room_corners.units}

You MUST align the reconstructed 2D geometry directly with this room boundary:
1. Coordinate (0, 0) MUST map to the room Top-Left corner.
2. Coordinate ({room_corners.planWidth}, {room_corners.planHeight}) MUST map to the room Bottom-Right corner.
3. Plan "width" MUST BE {room_corners.planWidth} and "height" MUST BE {room_corners.planHeight} with units="{room_corners.units}".
4. In "sourceImage", include:
   "cropX": {room_corners.cropX:.0f}, "cropY": {room_corners.cropY:.0f}, "cropWidth": {room_corners.cropWidth:.0f}, "cropHeight": {room_corners.cropHeight:.0f}
5. Outer Perimeter Walls: Add all boundary walls around the outside perimeter of the room. Where windows or doors are located, leave them as open blank gaps between adjacent wall segments.
"""

        # 4. Formulate OpenAI Responses API payload
        payload = {
            "model": self.settings.OPENAI_MODEL,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": active_instruction},
                        {"type": "input_image", "image_url": data_uri},
                    ],
                }
            ],
        }

        # 5. Invoke OpenAI API
        headers = {
            "Authorization": f"Bearer {self.settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        logger.info("Calling OpenAI Responses API with model: %s...", self.settings.OPENAI_MODEL)
        req = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            headers=headers,
            data=json.dumps(payload).encode("utf-8"),
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                res = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            logger.error("OpenAI API HTTPError %d: %s", e.code, err_body)
            raise RuntimeError(f"OpenAI API error ({e.code}): {err_body}")
        except Exception as e:
            logger.error("Failed to call OpenAI API: %s", e)
            raise RuntimeError(f"Failed to communicate with OpenAI API: {str(e)}")

        # 6. Extract text response
        raw_text = ""
        output_items = res.get("output", [])
        for item in output_items:
            if item.get("type") == "message":
                for c in item.get("content", []):
                    if c.get("type") == "output_text":
                        raw_text = c.get("text", "")
                        break
            if raw_text:
                break

        if not raw_text:
            logger.error("OpenAI response did not contain message output_text: %s", res)
            raise RuntimeError("No structured output received from OpenAI model.")

        # 7. Parse JSON from output text
        parsed_json = self._extract_json(raw_text)

        # 8. Normalize and validate geometry
        floor_plan = self.normalize_floor_plan(parsed_json, img_w, img_h, room_corners=room_corners)
        return floor_plan

    def normalize_floor_plan(
        self,
        data: Dict[str, Any],
        img_w: int,
        img_h: int,
        room_corners: Optional[RoomCorners] = None,
    ) -> FloorPlan:
        """Validate and normalize floor plan geometry according to docs/plan-parser.md rules."""
        fp_id = data.get("id") or "fp_001"
        units = data.get("units", "ft")
        if units not in ("ft", "m", "normalized"):
            units = "ft"

        # Plan bounds - use room_corners if available to enforce precise scale matching
        if room_corners and room_corners.planWidth > 0 and room_corners.planHeight > 0:
            width = float(room_corners.planWidth)
            height = float(room_corners.planHeight)
            units = room_corners.units
        else:
            try:
                width = float(data.get("width") or 40.0)
                height = float(data.get("height") or 30.0)
            except Exception:
                width, height = 40.0, 30.0

        if width <= 0 or not math.isfinite(width):
            width = 40.0
        if height <= 0 or not math.isfinite(height):
            height = 30.0

        scale_conf = float(data.get("scaleConfidence") or 0.9)
        scale_conf = max(0.0, min(1.0, scale_conf))

        # Source image metadata & crop bounds
        src_meta = data.get("sourceImage") or {}
        crop_x = float(src_meta.get("cropX") if src_meta.get("cropX") is not None else (room_corners.cropX if room_corners else 0))
        crop_y = float(src_meta.get("cropY") if src_meta.get("cropY") is not None else (room_corners.cropY if room_corners else 0))
        crop_w = float(src_meta.get("cropWidth") if src_meta.get("cropWidth") is not None else (room_corners.cropWidth if room_corners else img_w))
        crop_h = float(src_meta.get("cropHeight") if src_meta.get("cropHeight") is not None else (room_corners.cropHeight if room_corners else img_h))

        corners_map = None
        if room_corners:
            corners_map = {
                "topLeft": room_corners.topLeft,
                "topRight": room_corners.topRight,
                "bottomRight": room_corners.bottomRight,
                "bottomLeft": room_corners.bottomLeft,
            }

        source_image = SourceImage(
            width=int(src_meta.get("width") or img_w),
            height=int(src_meta.get("height") or img_h),
            cropX=crop_x,
            cropY=crop_y,
            cropWidth=crop_w,
            cropHeight=crop_h,
            corners=corners_map,
        )

        # Normalize Walls
        walls: List[Wall] = []
        raw_walls = data.get("walls", [])
        for i, w in enumerate(raw_walls):
            try:
                w_id = str(w.get("id") or f"wall_{i+1:03d}")
                x1 = float(w.get("x1", 0))
                y1 = float(w.get("y1", 0))
                x2 = float(w.get("x2", 0))
                y2 = float(w.get("y2", 0))
                thick = float(w.get("thickness", 0.55))
                ext = bool(w.get("exterior", False))
                conf = max(0.0, min(1.0, float(w.get("confidence", 0.9))))

                # Basic sanity check
                if math.isfinite(x1) and math.isfinite(y1) and math.isfinite(x2) and math.isfinite(y2):
                    walls.append(Wall(
                        id=w_id,
                        type="wall",
                        x1=round(x1, 2),
                        y1=round(y1, 2),
                        x2=round(x2, 2),
                        y2=round(y2, 2),
                        thickness=round(thick, 2) if thick > 0 else 0.55,
                        exterior=ext,
                        confidence=conf,
                    ))
            except Exception as e:
                logger.warning("Skipping invalid wall: %s (%s)", w, e)

        # Normalize Doors
        # Doors and windows are omitted per requirement (not created)
        doors: List[Door] = []
        windows: List[Window] = []

        # Normalize Furniture
        valid_furn_types = {
            "bed", "sofa", "chair", "armchair", "table", "coffee_table",
            "dining_table", "desk", "nightstand", "wardrobe", "cabinet",
            "kitchen_island", "unknown",
        }
        furniture: List[Furniture] = []
        raw_furn = data.get("furniture", [])
        for i, f in enumerate(raw_furn):
            try:
                f_id = str(f.get("id") or f"fur_{i+1:03d}")
                f_type = f.get("furnitureType", "unknown").lower().replace(" ", "_")
                if f_type not in valid_furn_types:
                    f_type = "unknown"
                label = str(f.get("label") or f_type.replace("_", " ").title())
                x = float(f.get("x", 0))
                y = float(f.get("y", 0))
                w_val = float(f.get("width", 3.0))
                h_val = float(f.get("height", 3.0))
                rot = float(f.get("rotation", 0)) % 360
                conf = max(0.0, min(1.0, float(f.get("confidence", 0.9))))

                if math.isfinite(x) and math.isfinite(y) and w_val > 0 and h_val > 0:
                    furniture.append(Furniture(
                        id=f_id,
                        type="furniture",
                        furnitureType=f_type,
                        label=label,
                        x=round(x, 2),
                        y=round(y, 2),
                        width=round(w_val, 2),
                        height=round(h_val, 2),
                        rotation=round(rot, 1),
                        confidence=conf,
                    ))
            except Exception as e:
                logger.warning("Skipping invalid furniture: %s (%s)", f, e)

        # Normalize Fixtures
        valid_fix_types = {
            "sink", "toilet", "bathtub", "shower", "stove", "oven",
            "refrigerator", "washer", "dryer", "counter", "unknown",
        }
        fixtures: List[Fixture] = []
        raw_fix = data.get("fixtures", [])
        for i, fix in enumerate(raw_fix):
            try:
                fix_id = str(fix.get("id") or f"fix_{i+1:03d}")
                fix_type = fix.get("fixtureType", "unknown").lower().replace(" ", "_")
                if fix_type not in valid_fix_types:
                    fix_type = "unknown"
                label = str(fix.get("label") or fix_type.replace("_", " ").title())
                x = float(fix.get("x", 0))
                y = float(fix.get("y", 0))
                w_val = float(fix.get("width", 2.0))
                h_val = float(fix.get("height", 2.0))
                rot = float(fix.get("rotation", 0)) % 360
                conf = max(0.0, min(1.0, float(fix.get("confidence", 0.9))))

                if math.isfinite(x) and math.isfinite(y) and w_val > 0 and h_val > 0:
                    fixtures.append(Fixture(
                        id=fix_id,
                        type="fixture",
                        fixtureType=fix_type,
                        label=label,
                        x=round(x, 2),
                        y=round(y, 2),
                        width=round(w_val, 2),
                        height=round(h_val, 2),
                        rotation=round(rot, 1),
                        confidence=conf,
                    ))
            except Exception as e:
                logger.warning("Skipping invalid fixture: %s (%s)", fix, e)

        # Normalize Rooms
        rooms: List[Room] = []
        raw_rooms = data.get("rooms", [])
        for i, r in enumerate(raw_rooms):
            try:
                r_id = str(r.get("id") or f"rom_{i+1:03d}")
                name = str(r.get("name") or f"Room {i+1}")
                raw_poly = r.get("polygon", [])
                poly: List[Point2D] = []
                for pt in raw_poly:
                    if isinstance(pt, dict) and "x" in pt and "y" in pt:
                        poly.append(Point2D(x=round(float(pt["x"]), 2), y=round(float(pt["y"]), 2)))

                stated = None
                raw_stated = r.get("statedDimensions")
                if isinstance(raw_stated, dict):
                    stated = StatedDimensions(
                        width=float(raw_stated["width"]) if "width" in raw_stated and raw_stated["width"] is not None else None,
                        height=float(raw_stated["height"]) if "height" in raw_stated and raw_stated["height"] is not None else None,
                    )

                conf = max(0.0, min(1.0, float(r.get("confidence", 0.9))))
                rooms.append(Room(
                    id=r_id,
                    name=name,
                    polygon=poly,
                    statedDimensions=stated,
                    confidence=conf,
                ))
            except Exception as e:
                logger.warning("Skipping invalid room: %s (%s)", r, e)

        return FloorPlan(
            id=fp_id,
            units=units,
            width=round(width, 2),
            height=round(height, 2),
            sourceImage=source_image,
            scaleConfidence=scale_conf,
            rooms=rooms,
            walls=walls,
            doors=doors,
            windows=windows,
            furniture=furniture,
            fixtures=fixtures,
            metadata={"parsedBy": "gpt-6-sol", "parserVersion": "1.0"},
        )

    def execute_plan_parsing_job(self, task: ParsePlanTaskRequest) -> FloorPlan:
        """Full job workflow: fetch image -> analyze -> normalize -> save to Firestore."""
        db = get_firestore_client()
        job_ref = db.collection("jobs").document(task.jobId)
        project_ref = db.collection("projects").document(task.projectId)

        logger.info("Executing plan parsing job %s for project %s", task.jobId, task.projectId)

        # 1. Update job to running
        job_ref.set({
            "id": task.jobId,
            "type": "plan_parse",
            "projectId": task.projectId,
            "ownerUid": task.ownerUid,
            "status": "running",
            "stage": "downloading_image",
            "progress": 20,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)

        project_ref.update({
            "status": "processing",
            "currentJobId": task.jobId,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        image_bytes: Optional[bytes] = None

        # 2. Retrieve image bytes from signed URL or GCS
        try:
            if task.signedUrl:
                logger.info("Downloading plan image from signedUrl...")
                with httpx.Client(timeout=60.0) as client:
                    resp = client.get(task.signedUrl)
                    if resp.status_code == 200:
                        image_bytes = resp.content

            if not image_bytes and task.gcsPath:
                logger.info("Downloading plan image from GCS: %s", task.gcsPath)
                storage_client = get_storage_client()
                bucket = storage_client.bucket(self.settings.GCS_BUCKET_NAME)
                blob = bucket.blob(task.gcsPath)
                image_bytes = blob.download_as_bytes()

            if not image_bytes:
                # Look up project's planImage in Firestore
                proj_doc = project_ref.get()
                if proj_doc.exists:
                    p_data = proj_doc.to_dict() or {}
                    p_plan = p_data.get("planImage") or {}
                    storage_path = p_plan.get("storagePath")
                    if storage_path:
                        storage_client = get_storage_client()
                        bucket = storage_client.bucket(self.settings.GCS_BUCKET_NAME)
                        blob = bucket.blob(storage_path)
                        image_bytes = blob.download_as_bytes()

            if not image_bytes:
                raise ValueError("Could not find or download floor plan image for parsing.")

        except Exception as e:
            logger.error("Failed downloading image for job %s: %s", task.jobId, e)
            job_ref.update({
                "status": "failed",
                "error": f"Failed to retrieve floor plan image: {str(e)}",
                "stage": "failed",
                "progress": 100,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            project_ref.update({
                "status": "failed",
                "lastError": str(e),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            raise

        # 3A. Pre-parsing Step: Detect exactly 4 angles/corners of the room & match scale
        logger.info("Pre-parsing step: Detecting 4 room corners and matching scale for job %s...", task.jobId)
        job_ref.update({
            "stage": "detecting_room_corners",
            "progress": 35,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        project_ref.update({
            "stage": "detecting_room_corners",
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        room_corners: Optional[RoomCorners] = None
        try:
            room_corners = self.detect_room_corners(image_bytes, mime_type=task.contentType or "image/png")
            corners_dict = room_corners.model_dump()
            logger.info("Successfully detected 4 room angles: %s", corners_dict)
            job_ref.update({
                "roomCorners": corners_dict,
                "progress": 50,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            project_ref.update({
                "roomCorners": corners_dict,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        except Exception as e:
            logger.warning("Room corner detection encountered warning: %s. Continuing with default scale.", e)

        # 3B. Full vision parsing calibrated to room footprint
        job_ref.update({
            "stage": "analyzing_with_ai",
            "progress": 65,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        try:
            floor_plan = self.parse_image_bytes(
                image_bytes,
                mime_type=task.contentType or "image/png",
                room_corners=room_corners,
            )
        except Exception as e:
            logger.error("Error during OpenAI analysis for job %s: %s", task.jobId, e)
            job_ref.update({
                "status": "failed",
                "error": f"AI Parsing failed: {str(e)}",
                "stage": "failed",
                "progress": 100,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            project_ref.update({
                "status": "failed",
                "lastError": str(e),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
            raise

        # 4. Save results to Firestore
        job_ref.update({
            "stage": "saving_results",
            "progress": 90,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        plan_dict = floor_plan.model_dump()

        # Update Project in Firestore
        project_ref.update({
            "status": "completed",
            "hasPlanParsed": True,
            "floorPlan": plan_dict,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        # Save to subcollection projects/{projectId}/floorPlans/{planId}
        project_ref.collection("floorPlans").document(floor_plan.id).set({
            **plan_dict,
            "jobId": task.jobId,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })

        # Update Job in Firestore to completed
        job_ref.update({
            "status": "completed",
            "stage": "completed",
            "progress": 100,
            "result": plan_dict,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        logger.info("Successfully completed plan parsing job %s for project %s", task.jobId, task.projectId)
        return floor_plan

    @staticmethod
    def _extract_json(text: str) -> Dict[str, Any]:
        """Strip markdown fences and parse JSON object from string."""
        cleaned = text.strip()
        # Remove ```json and ``` if present
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()

        # Search for first { and last } if extra text exists
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start : end + 1]

        return json.loads(cleaned)

    def isolate_furniture_transparent_background(
        self,
        image_bytes: bytes,
        mime_type: str = "image/jpeg",
        furniture_name: str = "furniture",
    ) -> Dict[str, Any]:
        """
        Calls OpenAI gpt-6-sol with image_generation tool to isolate furniture
        with prompt '{uploaded_furniture} transparent background'.
        Returns data URI with a transparent background PNG.
        """
        clean_name = (furniture_name or "furniture").strip()
        prompt = f"{clean_name} transparent background"

        media_type = mime_type if mime_type in ("image/png", "image/jpeg", "image/webp") else "image/jpeg"
        b64_data = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{media_type};base64,{b64_data}"

        payload = {
            "model": self.settings.OPENAI_MODEL,
            "tools": [{"type": "image_generation"}],
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_image", "image_url": data_uri},
                    ],
                }
            ],
        }

        headers = {
            "Authorization": f"Bearer {self.settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        logger.info("Calling OpenAI Responses API (%s) to generate transparent background for: '%s'", self.settings.OPENAI_MODEL, prompt)
        req = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            headers=headers,
            data=json.dumps(payload).encode("utf-8"),
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                res = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            logger.error("OpenAI API HTTPError %d: %s", e.code, err_body)
            raise RuntimeError(f"OpenAI API error ({e.code}): {err_body}")
        except Exception as e:
            logger.error("Failed to call OpenAI API: %s", e)
            raise RuntimeError(f"Failed to communicate with OpenAI API: {str(e)}")

        result_b64 = None
        for item in res.get("output", []):
            if item.get("type") == "image_generation_call":
                result_b64 = item.get("result")
                if result_b64:
                    break

        if not result_b64:
            logger.error("OpenAI response did not contain image_generation_call result: %s", res)
            raise RuntimeError("No image returned from OpenAI model for transparent background.")

        # Post-process with alpha channel if PIL is available
        if HAS_PIL and result_b64:
            try:
                raw_bytes = base64.b64decode(result_b64)
                im = Image.open(io.BytesIO(raw_bytes))
                im_trans = self._make_alpha_transparent(im)
                buf = io.BytesIO()
                im_trans.save(buf, format="PNG")
                result_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            except Exception as e:
                logger.warning("Alpha transparency post-processing failed, using raw output: %s", e)

        return {
            "status": "success",
            "furnitureName": clean_name,
            "prompt": prompt,
            "model": self.settings.OPENAI_MODEL,
            "mimeType": "image/png",
            "dataUri": f"data:image/png;base64,{result_b64}",
            "result": result_b64,
        }

    def _make_alpha_transparent(self, im: Any) -> Any:
        """Converts checkerboard or outer light background into clean RGBA alpha transparency."""
        if not HAS_PIL:
            return im
        im = im.convert("RGBA")
        w, h = im.size
        pixels = im.load()

        alpha_extrema = im.split()[-1].getextrema()
        if alpha_extrema[0] < 128:
            return im

        corner_colors = [pixels[0, 0][:3], pixels[w - 1, 0][:3], pixels[0, h - 1][:3], pixels[w - 1, h - 1][:3]]
        avg_corner = sum(sum(c) / 3 for c in corner_colors) / 4
        if avg_corner < 180:
            return im

        def is_bg(r: int, g: int, b: int) -> bool:
            diff = max(abs(r - g), abs(g - b), abs(r - b))
            if diff <= 8:
                if (234 <= r <= 248) or (249 <= r <= 255):
                    return True
            return False

        import collections
        visited = set()
        queue = collections.deque()
        for x in range(w):
            if is_bg(*pixels[x, 0][:3]):
                queue.append((x, 0))
            if is_bg(*pixels[x, h - 1][:3]):
                queue.append((x, h - 1))
        for y in range(h):
            if is_bg(*pixels[0, y][:3]):
                queue.append((0, y))
            if is_bg(*pixels[w - 1, y][:3]):
                queue.append((w - 1, y))

        while queue:
            x, y = queue.popleft()
            if (x, y) in visited:
                continue
            visited.add((x, y))

            r, g, b, a = pixels[x, y]
            if is_bg(r, g, b):
                pixels[x, y] = (0, 0, 0, 0)
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                        queue.append((nx, ny))

        return im
