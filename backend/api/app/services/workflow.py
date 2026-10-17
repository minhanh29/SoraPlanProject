"""The chat-first project flow: stage transitions shared by UI actions and Gemini tools.

    uploading → cropping → parsing → reviewing_plan → choosing_style → resolving_missing → scene_ready

Every transition writes the conversation stage and a predefined message (kind + payload only; the
web app renders the copy from web/src/chat/messageTemplates.ts).
"""
import datetime
import logging
import math
import os
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from ..config import get_settings
from ..errors import AppException, ConflictException
from . import crop_service
from .asset_mapper import map_plan, refit_entry, unresolved
from .asset_service import AssetService, SIGNED_URL_TTL
from .common import SERVER_TIMESTAMP, get_owned, load_styles, utcnow
from .conversation_service import ConversationService
from .project_service import ProjectService
from .scene_builder import build_scene
from .scene_ops import SceneService
from .storage_service import StorageService

logger = logging.getLogger("api.workflow")

STAGES = ["uploading", "cropping", "parsing", "reviewing_plan", "choosing_style", "resolving_missing", "scene_ready"]
PLAN_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf"}


@dataclass
class Ctx:
    uid: str
    conversation_id: str
    source: str = "ui"  # "ui" | "agent"
    user_confirmed: bool = True  # UI buttons confirm in-page; the agent passes the user's last answer


class NeedsConfirmation(AppException):
    def __init__(self, what: str):
        super().__init__(status_code=409, code="NEEDS_CONFIRMATION", detail=f"Ask the user to confirm first: {what}")


def stage_index(stage: str) -> int:
    return STAGES.index(stage) if stage in STAGES else 0


def title_from_filename(name: str) -> str:
    stem = os.path.splitext(os.path.basename(name or ""))[0]
    stem = re.sub(r"[_\-]+", " ", stem).strip()
    return (stem[:1].upper() + stem[1:])[:80] if stem else "New project"


def _finite(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def sanitize_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Validate an edited FloorPlan from the browser (lenient: unknown fields are dropped)."""
    if not isinstance(plan, dict):
        raise AppException(status_code=400, code="INVALID_PLAN", detail="floorPlan must be an object")
    units = plan.get("units") if plan.get("units") in ("ft", "m", "normalized") else "ft"
    width, height = _finite(plan.get("width"), 0), _finite(plan.get("height"), 0)
    if width <= 0 or height <= 0:
        raise AppException(status_code=400, code="INVALID_PLAN", detail="Plan width and height must be positive")

    def boxes(key: str, kind: str) -> List[dict]:
        out, seen = [], set()
        for b in plan.get(key) or []:
            if not isinstance(b, dict) or not b.get("id") or b["id"] in seen:
                continue
            w, h = _finite(b.get("width")), _finite(b.get("height"))
            if w <= 0 or h <= 0:
                continue
            seen.add(b["id"])
            item = {
                "id": str(b["id"])[:64],
                "type": kind,
                "label": str(b.get("label") or "")[:80],
                "x": round(_finite(b.get("x")), 3),
                "y": round(_finite(b.get("y")), 3),
                "width": round(w, 3),
                "height": round(h, 3),
                "rotation": round(_finite(b.get("rotation")) % 360, 2),
                "confidence": max(0.0, min(1.0, _finite(b.get("confidence"), 0.9))),
                "category": (str(b["category"])[:60] if b.get("category") else None),
                "addedBy": b.get("addedBy") if b.get("addedBy") in ("parser", "user") else "parser",
            }
            if kind == "furniture":
                item["furnitureType"] = str(b.get("furnitureType") or "unknown")[:40]
            else:
                item["fixtureType"] = str(b.get("fixtureType") or "unknown")[:40]
            out.append(item)
        return out

    walls = []
    for w in plan.get("walls") or []:
        if not isinstance(w, dict) or not w.get("id"):
            continue
        walls.append({
            "id": str(w["id"])[:64], "type": "wall",
            "x1": round(_finite(w.get("x1")), 3), "y1": round(_finite(w.get("y1")), 3),
            "x2": round(_finite(w.get("x2")), 3), "y2": round(_finite(w.get("y2")), 3),
            "thickness": max(0.01, round(_finite(w.get("thickness"), 0.5), 3)),
            "exterior": bool(w.get("exterior")),
            "confidence": max(0.0, min(1.0, _finite(w.get("confidence"), 0.9))),
        })

    def openings(key: str, kind: str) -> List[dict]:
        out = []
        for o in plan.get(key) or []:
            if isinstance(o, dict) and o.get("id") and _finite(o.get("width")) > 0:
                out.append({"id": str(o["id"])[:64], "type": kind, "x": _finite(o.get("x")), "y": _finite(o.get("y")),
                            "width": _finite(o.get("width")), "rotation": _finite(o.get("rotation")), "wallId": o.get("wallId"),
                            "swing": o.get("swing") if isinstance(o.get("swing"), str) else None})
        return out

    rooms = []
    for r in plan.get("rooms") or []:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        poly = [{"x": round(_finite(p.get("x")), 3), "y": round(_finite(p.get("y")), 3)}
                for p in r.get("polygon") or [] if isinstance(p, dict)]
        lp = r.get("labelPosition")
        label_pos = {"x": _finite(lp.get("x")), "y": _finite(lp.get("y"))} if isinstance(lp, dict) else None
        rooms.append({"id": str(r["id"])[:64], "name": str(r.get("name") or "Room")[:60], "polygon": poly, "labelPosition": label_pos,
                      "statedDimensions": r.get("statedDimensions"), "confidence": _finite(r.get("confidence"), 0.9)})

    return {
        "id": str(plan.get("id") or "fp_001")[:64],
        "units": units,
        "width": round(width, 3),
        "height": round(height, 3),
        "sourceImage": plan.get("sourceImage") if isinstance(plan.get("sourceImage"), dict) else None,
        "scaleConfidence": max(0.0, min(1.0, _finite(plan.get("scaleConfidence"), 0.9))),
        "rooms": rooms,
        "walls": walls,
        "doors": openings("doors", "door"),
        "windows": openings("windows", "window"),
        "furniture": boxes("furniture", "furniture"),
        "fixtures": boxes("fixtures", "fixture"),
        "metadata": plan.get("metadata") if isinstance(plan.get("metadata"), dict) else None,
    }


class Workflow:
    def __init__(
        self,
        db,
        storage: StorageService,
        conversations: ConversationService,
        projects: ProjectService,
        assets: AssetService,
        scenes: SceneService,
        classify: Optional[Callable] = None,
    ):
        self.db = db
        self.storage = storage
        self.conversations = conversations
        self.projects = projects
        self.assets = assets
        self.scenes = scenes
        self.classify = classify
        self.settings = get_settings()

    # ------------------------------------------------------------------ helpers

    def _project_ref(self, project_id: str):
        return self.db.collection("projects").document(project_id)

    def _load(self, ctx: Ctx):
        conv = self.conversations.get(ctx.conversation_id, ctx.uid)
        project = get_owned(self.db, "projects", conv["projectId"], ctx.uid)
        return conv, project

    def _require_stage(self, conv: dict, allowed: List[str], action: str) -> None:
        if conv.get("stage") not in allowed:
            raise AppException(
                status_code=409,
                code="WRONG_STAGE",
                detail=f"'{action}' is not available while the project is in stage '{conv.get('stage')}'",
            )

    def _style_cards(self) -> List[dict]:
        return [
            {"id": sid, "name": s["name"], "coverUrl": f"{self.settings.catalog_base_url}/{s['cover']}", "blurb": s.get("blurb", "")}
            for sid, s in load_styles().items()
        ]

    # ------------------------------------------------------------------ create + upload

    def create(self, uid: str, file_name: str, content_type: str, size_bytes: Optional[int]) -> dict:
        ctype = (content_type or "").lower().strip()
        if ctype not in PLAN_TYPES:
            import mimetypes

            ctype = (mimetypes.guess_type(file_name)[0] or "").lower()
        if ctype not in PLAN_TYPES:
            raise AppException(status_code=400, code="UNSUPPORTED_FILE_TYPE",
                               detail="Upload a floor plan as PNG, JPEG, WebP or PDF")
        if size_bytes and size_bytes > self.settings.MAX_UPLOAD_SIZE_BYTES:
            raise AppException(status_code=400, code="FILE_TOO_LARGE", detail="The file is larger than 25 MB")
        self.projects._check_project_quota(uid)

        ref = self.db.collection("projects").document()
        pid = ref.id
        title = title_from_filename(file_name)
        path = f"{uid}/{pid}/original{PLAN_TYPES[ctype]}"
        ref.set({
            "id": pid,
            "ownerUid": uid,
            "name": title,
            "description": None,
            "status": "created",
            "conversationId": pid,
            "style": None,
            "hasPlan": False,
            "planImageOriginal": {"storagePath": path, "contentType": ctype, "fileName": file_name, "sizeBytes": size_bytes or 0},
            "planImage": None,
            "crop": None,
            "floorPlan": None,
            "floorPlanVersion": 0,
            "mapping": {},
            "missing": [],
            "createdAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP,
        })
        self.conversations.create(pid, uid, title)
        url = self.storage.generate_signed_upload_url(path, ctype, expiration_seconds=900)
        return {"projectId": pid, "conversationId": pid, "signedUploadUrl": url, "contentType": ctype}

    def upload_complete(self, conversation_id: str, uid: str) -> str:
        conv = self.conversations.get(conversation_id, uid)
        if conv.get("stage") != "uploading":
            return conv["stage"]  # idempotent
        project = get_owned(self.db, "projects", conv["projectId"], uid)
        original = dict(project.get("planImageOriginal") or {})
        path = original.get("storagePath")
        if not path or not self.storage.blob_exists(path):
            raise AppException(status_code=400, code="UPLOAD_NOT_FOUND", detail="The file upload did not finish")

        data = self.storage.download_bytes(path)
        if original.get("contentType") == "application/pdf":
            data = crop_service.pdf_first_page_to_png(data)
        png, width, height = crop_service.normalize_upload(data)
        norm_path = f"{uid}/{project['id']}/original.png"
        self.storage.upload_bytes(png, norm_path, "image/png")
        thumb_path = f"{uid}/{project['id']}/thumb.jpg"
        self.storage.upload_bytes(crop_service.thumbnail(png), thumb_path, "image/jpeg")
        original.update({"storagePath": norm_path, "contentType": "image/png", "width": width, "height": height,
                         "sourcePath": path})

        self._project_ref(project["id"]).update({
            "planImageOriginal": original,
            "thumbnailPath": thumb_path,
            "status": "uploaded",
            "updatedAt": SERVER_TIMESTAMP,
        })
        self.conversations.set_stage(
            conversation_id,
            "cropping",
            stageData={"crop": None},
            thumbnailUrl=self.storage.generate_signed_read_url(thumb_path, expiration_seconds=SIGNED_URL_TTL),
            thumbnailExpiresAt=(utcnow() + datetime.timedelta(seconds=SIGNED_URL_TTL)).isoformat(),
        )
        self.conversations.append_message(conversation_id, "system", "crop_request", payload={"width": width, "height": height})
        return "cropping"

    # ------------------------------------------------------------------ crop → parse

    def confirm_crop(self, ctx: Ctx, crop: Optional[Dict[str, float]] = None) -> dict:
        conv, project = self._load(ctx)
        self._require_stage(conv, ["cropping"], "confirm_crop")
        original = project.get("planImageOriginal") or {}
        width, height = int(original.get("width") or 0), int(original.get("height") or 0)
        if not width or not height:
            raise AppException(status_code=409, code="NO_PLAN_IMAGE", detail="Upload a floor plan first")
        crop = crop or (conv.get("stageData") or {}).get("crop") or {"x": 0, "y": 0, "width": width, "height": height}
        rect = crop_service.clamp_crop(crop, width, height)

        cropped = crop_service.crop_image(self.storage.download_bytes(original["storagePath"]), rect)
        n = int(project.get("cropCount") or 0) + 1
        path = f"{ctx.uid}/{project['id']}/plan_{n}.png"
        self.storage.upload_bytes(cropped, path, "image/png")
        plan_image = {
            "id": f"plan_{n}",
            "projectId": project["id"],
            "ownerUid": ctx.uid,
            "fileName": f"plan_{n}.png",
            "contentType": "image/png",
            "sizeBytes": len(cropped),
            "bucket": self.storage.bucket_name,
            "storagePath": path,
            "gcsUri": f"gs://{self.storage.bucket_name}/{path}",
            "width": rect["width"],
            "height": rect["height"],
            "uploadedAt": utcnow().isoformat(),
        }
        self._project_ref(project["id"]).update({
            "planImage": plan_image,
            "hasPlan": True,
            "crop": rect,
            "cropCount": n,
            "floorPlan": None,
            "mapping": {},
            "missing": [],
            "updatedAt": SERVER_TIMESTAMP,
        })
        self.scenes.delete(project["id"])
        self.conversations.update(ctx.conversation_id, stageData={"crop": rect})
        return self._start_parse(ctx, project["id"])

    def _start_parse(self, ctx: Ctx, project_id: str) -> dict:
        job = self.projects.trigger_plan_parsing(project_id, ctx.uid, cropped=True)
        self.conversations.set_stage(ctx.conversation_id, "parsing")
        self.conversations.set_busy(ctx.conversation_id, True, "parsing")
        self.conversations.append_message(ctx.conversation_id, "system", "parse_started", payload={"jobId": job["jobId"]})
        return {"jobId": job["jobId"], "stage": "parsing"}

    def retry_parse(self, ctx: Ctx) -> dict:
        conv, project = self._load(ctx)
        self._require_stage(conv, ["cropping"], "retry_parse")
        if not project.get("planImage"):
            raise AppException(status_code=409, code="NO_CROP", detail="Confirm the crop first")
        return self._start_parse(ctx, project["id"])

    def restart_crop(self, ctx: Ctx) -> dict:
        conv, project = self._load(ctx)
        if stage_index(conv.get("stage", "")) < stage_index("parsing"):
            return {"stage": conv.get("stage")}
        if stage_index(conv["stage"]) >= stage_index("reviewing_plan") and not ctx.user_confirmed:
            raise NeedsConfirmation("re-cropping discards the parsed plan and the 3D scene")
        self.conversations.set_busy(ctx.conversation_id, False)
        self.conversations.set_stage(ctx.conversation_id, "cropping", stageData={"crop": project.get("crop")})
        original = project.get("planImageOriginal") or {}
        self.conversations.append_message(ctx.conversation_id, "system", "crop_request",
                                          payload={"width": original.get("width"), "height": original.get("height")})
        return {"stage": "cropping"}

    # ------------------------------------------------------------------ plan review

    def save_plan(self, project_id: str, uid: str, floor_plan: Dict[str, Any]) -> int:
        project = get_owned(self.db, "projects", project_id, uid)
        conv = self.conversations.get(project.get("conversationId") or project_id, uid)
        self._require_stage(conv, ["reviewing_plan"], "edit the plan")
        plan = sanitize_plan(floor_plan)
        version = int(project.get("floorPlanVersion") or 0) + 1
        self._project_ref(project_id).update({"floorPlan": plan, "floorPlanVersion": version, "updatedAt": SERVER_TIMESTAMP})
        return version

    def confirm_plan(self, ctx: Ctx) -> dict:
        conv, project = self._load(ctx)
        self._require_stage(conv, ["reviewing_plan"], "confirm_plan")
        if not project.get("floorPlan"):
            raise AppException(status_code=409, code="NO_PLAN", detail="The plan has not been parsed yet")
        self.conversations.set_stage(ctx.conversation_id, "choosing_style")
        self.conversations.append_message(ctx.conversation_id, "system", "style_picker",
                                          payload={"styles": self._style_cards(), "selected": project.get("style")})
        return {"stage": "choosing_style"}

    def edit_plan(self, ctx: Ctx) -> dict:
        conv, _ = self._load(ctx)
        self._require_stage(conv, ["choosing_style", "resolving_missing", "scene_ready"], "edit_plan")
        if conv["stage"] == "scene_ready" and not ctx.user_confirmed:
            raise NeedsConfirmation("editing the plan rebuilds the 3D scene and drops changes made in 3D")
        self.conversations.set_stage(ctx.conversation_id, "reviewing_plan")
        return {"stage": "reviewing_plan"}

    # ------------------------------------------------------------------ style + mapping

    def select_style(self, ctx: Ctx, style: str) -> dict:
        conv, project = self._load(ctx)
        self._require_stage(conv, ["choosing_style", "resolving_missing", "scene_ready"], "select_style")
        if style not in load_styles():
            raise AppException(status_code=400, code="INVALID_STYLE", detail=f"Unknown style '{style}'. Use one of {list(load_styles())}")
        if conv["stage"] == "scene_ready" and not ctx.user_confirmed:
            raise NeedsConfirmation("changing the style rebuilds the 3D scene")

        if ctx.source != "agent":  # an agent turn already holds the busy flag
            self.conversations.set_busy(ctx.conversation_id, True, "mapping")
        try:
            mapping, missing = map_plan(
                project["floorPlan"],
                style,
                self.assets.placeable_assets(ctx.uid),
                previous=project.get("mapping") or {},
                classify=self.classify,
                user_uid=ctx.uid,
            )
            self._project_ref(project["id"]).update({"style": style, "mapping": mapping, "missing": missing, "updatedAt": SERVER_TIMESTAMP})
            matched = sum(1 for e in mapping.values() if e.get("assetId"))
            if missing:
                self.conversations.set_stage(ctx.conversation_id, "resolving_missing")
                self.conversations.append_message(ctx.conversation_id, "system", "mapping_result",
                                                  payload={"style": style, "matched": matched, "missing": missing})
                return {"stage": "resolving_missing", "matched": matched, "missing": len(missing)}
            project.update({"style": style, "mapping": mapping})
            return self._build(ctx, project, matched)
        finally:
            if ctx.source != "agent":
                self.conversations.set_busy(ctx.conversation_id, False)

    def update_mapping(self, project_id: str, uid: str, component_id: str, dims: Optional[dict], asset_id: Optional[str],
                       apply_to_same_asset: bool, reset: bool, restore: bool = False) -> Dict[str, Any]:
        project = get_owned(self.db, "projects", project_id, uid)
        conv = self.conversations.get(project.get("conversationId") or project_id, uid)
        self._require_stage(conv, ["resolving_missing", "scene_ready"], "change a mapped model")
        mapping = dict(project.get("mapping") or {})
        entry = mapping.get(component_id)
        if entry is None:
            raise AppException(status_code=404, code="COMPONENT_NOT_FOUND", detail=f"No plan object '{component_id}'")
        entry = dict(entry)

        if restore:
            # Undo a Skip: back to "needs a model" (only meaningful before the 3D build)
            self._require_stage(conv, ["resolving_missing"], "restore a skipped item")
            mapping[component_id] = {**entry, "skipped": False}
            self._project_ref(project_id).update({"mapping": mapping, "missing": unresolved(mapping), "updatedAt": SERVER_TIMESTAMP})
            return mapping

        if asset_id:
            asset = self.assets.get_readable(asset_id, uid)
            # The chosen model defines what the box is (symbol, height range, seat orientation)
            entry.update({"assetId": asset_id, "category": asset.get("category") or entry.get("category"), "skipped": False,
                          "dimsSource": "auto"})
            entry = refit_entry(project["floorPlan"], component_id, entry, asset, project.get("mapping"))
            mapping[component_id] = entry
            missing = [m for m in project.get("missing") or [] if m.get("componentId") != component_id]
            self._project_ref(project_id).update({"mapping": mapping, "missing": missing, "updatedAt": SERVER_TIMESTAMP})
            return mapping

        targets = [component_id]
        if apply_to_same_asset and entry.get("assetId"):
            targets = [cid for cid, e in mapping.items() if e.get("assetId") == entry["assetId"]]
        for cid in targets:
            e = dict(mapping[cid])
            if reset:
                e["dims"] = e.get("autoDims")
                e["dimsSource"] = "auto"
            elif dims:
                e["dims"] = {k: round(float(dims[k]), 4) for k in ("w", "d", "h")}
                e["dimsSource"] = "user"
            mapping[cid] = e
        self._project_ref(project_id).update({**{f"mapping.{cid}": mapping[cid] for cid in targets}, "updatedAt": SERVER_TIMESTAMP})
        return mapping

    def skip_missing(self, ctx: Ctx, component_ids: Optional[List[str]] = None, build_when_done: bool = True) -> dict:
        conv, project = self._load(ctx)
        self._require_stage(conv, ["resolving_missing"], "skip_missing")
        mapping = dict(project.get("mapping") or {})
        ids = component_ids or [m["componentId"] for m in unresolved(mapping)]
        for cid in ids:
            if cid in mapping and not mapping[cid].get("assetId"):
                mapping[cid] = {**mapping[cid], "skipped": True}
        missing = unresolved(mapping)
        self._project_ref(project["id"]).update({"mapping": mapping, "missing": missing, "updatedAt": SERVER_TIMESTAMP})
        project["mapping"] = mapping
        if missing or not build_when_done:
            return {"stage": "resolving_missing", "missing": len(missing)}
        matched = sum(1 for e in mapping.values() if e.get("assetId"))
        if ctx.source != "agent":
            self.conversations.set_busy(ctx.conversation_id, True, "building")
        try:
            return self._build(ctx, project, matched)
        finally:
            if ctx.source != "agent":
                self.conversations.set_busy(ctx.conversation_id, False)

    def continue_(self, ctx: Ctx) -> dict:
        """Mapping "Continue": anything still without a model is skipped, then the scene is built."""
        return self.skip_missing(ctx, None)

    def _build(self, ctx: Ctx, project: dict, matched: int) -> dict:
        graph = build_scene(project["id"], project["floorPlan"], project["style"], project.get("mapping") or {})
        version = self.scenes.save_built(project["id"], ctx.uid, graph)
        self._project_ref(project["id"]).update({"status": "completed", "sceneVersion": version, "updatedAt": SERVER_TIMESTAMP})
        self.conversations.set_stage(ctx.conversation_id, "scene_ready")
        self.conversations.append_message(ctx.conversation_id, "system", "scene_ready",
                                          payload={"sceneVersion": version, "style": project["style"], "matched": matched,
                                                   "items": len(graph["levels"][0]["items"])})
        return {"stage": "scene_ready", "sceneVersion": version}

    # ------------------------------------------------------------------ misc

    def files(self, project_id: str, uid: str) -> Dict[str, Optional[str]]:
        project = get_owned(self.db, "projects", project_id, uid)
        original = (project.get("planImageOriginal") or {}).get("storagePath")
        cropped = (project.get("planImage") or {}).get("storagePath")
        out = {
            "planOriginalUrl": self.storage.generate_signed_read_url(original) if original and project.get("status") != "created" else None,
            "planUrl": self.storage.generate_signed_read_url(cropped) if cropped else None,
        }
        # Keep the sidebar thumbnail fresh for conversations that are opened
        thumb = project.get("thumbnailPath")
        if thumb:
            try:
                conv = self.conversations.get(project.get("conversationId") or project_id, uid)
                exp = conv.get("thumbnailExpiresAt")
                if not exp or (datetime.datetime.fromisoformat(exp) - utcnow()).total_seconds() < 86400:
                    self.conversations.update(
                        conv["id"],
                        thumbnailUrl=self.storage.generate_signed_read_url(thumb, expiration_seconds=SIGNED_URL_TTL),
                        thumbnailExpiresAt=(utcnow() + datetime.timedelta(seconds=SIGNED_URL_TTL)).isoformat(),
                    )
            except Exception as e:
                logger.warning("Thumbnail refresh failed for %s: %s", project_id, e)
        return out

    def rename(self, conversation_id: str, uid: str, title: str) -> None:
        conv = self.conversations.get(conversation_id, uid)
        self.conversations.update(conversation_id, title=title.strip())
        self._project_ref(conv["projectId"]).update({"name": title.strip(), "updatedAt": SERVER_TIMESTAMP})

    def set_crop(self, conversation_id: str, uid: str, crop: Dict[str, float]) -> None:
        conv = self.conversations.get(conversation_id, uid)
        if conv.get("stage") != "cropping":
            raise ConflictException(detail="The crop can only change while cropping", code="WRONG_STAGE")
        self.conversations._ref(conversation_id).update({"stageData.crop": {k: round(float(crop[k])) for k in ("x", "y", "width", "height")}})

    def delete(self, conversation_id: str, uid: str) -> None:
        conv = self.conversations.get(conversation_id, uid)
        pid = conv["projectId"]
        self.scenes.delete(pid)
        try:
            self.projects.delete_project(pid, uid)
        except Exception as e:
            logger.warning("Project %s delete: %s", pid, e)
        self.conversations.delete(conversation_id)
