"""Top-level asset library (assets/{assetId}): system catalog + user uploads → Meshy → GLB.

Meshy progress is polled server-side: through the Cloud Tasks queue MESHY_POLL_QUEUE calling
POST /internal/assets/{id}/poll (re-enqueued every MESHY_POLL_INTERVAL_SECONDS), or a background
thread locally. The browser only listens to the asset doc.
"""
import base64
import datetime
import json
import math
import logging
import mimetypes
import os
import threading
import time
from typing import Any, Dict, List, Optional

import requests

from ..config import get_settings
from ..errors import AppException, ForbiddenException, NotFoundException
from ..models.user import UserProfile
from .asset_mapper import CATALOG_CATEGORIES, plan_boxes, refit_entry
from .common import SERVER_TIMESTAMP, load_system_catalog, utcnow
from .glb import glb_dims
from .meshy_service import MeshyService
from .storage_service import StorageService

logger = logging.getLogger("api.asset_service")

SIGNED_URL_TTL = 7 * 24 * 3600  # V4 maximum
REFRESH_BEFORE = 24 * 3600
PHOTO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp"}
STYLES = ("Industrial", "Japandi")


def system_asset_doc(item: dict, catalog_base_url: str) -> dict:
    """Firestore shape of a preset catalog entry (also used as fallback when Firestore is not seeded)."""
    def url(p: Optional[str]) -> Optional[str]:
        return f"{catalog_base_url}/{p}" if p else None

    return {
        "id": item["id"],
        "ownerUid": None,
        "isSystem": True,
        "name": item["name"],
        "category": item["category"],
        "style": item.get("style"),
        "imagePath": item.get("imagePath"),
        "glbPath": item.get("glbPath"),
        "glbWebPath": item.get("glbWebPath"),
        "imageUrl": url(item.get("imagePath")),
        "glbUrl": url(item.get("glbPath")),
        "glbWebUrl": url(item.get("glbWebPath")),
        "dims": item.get("dims"),
        "frontAxis": item.get("frontAxis") or "+z",
        "status": "ready",
        "progress": 100,
    }


class AssetService:
    def __init__(self, db, storage_service: StorageService, meshy_service: Optional[MeshyService] = None):
        self.db = db
        self.storage = storage_service
        self.meshy = meshy_service or MeshyService()
        self.settings = get_settings()

    # ------------------------------------------------------------------ reads

    def _ref(self, asset_id: str):
        return self.db.collection("assets").document(asset_id)

    def get(self, asset_id: str) -> Optional[dict]:
        snap = self._ref(asset_id).get()
        if snap.exists:
            return {"id": asset_id, **(snap.to_dict() or {})}
        for item in load_system_catalog():
            if item["id"] == asset_id:
                return system_asset_doc(item, self.settings.catalog_base_url)
        return None

    def get_readable(self, asset_id: str, uid: str) -> dict:
        a = self.get(asset_id)
        if not a or not (a.get("isSystem") or a.get("ownerUid") == uid):
            raise NotFoundException(detail="Asset not found", code="ASSET_NOT_FOUND")
        return a

    def system_assets(self) -> List[dict]:
        docs = [{"id": s.id, **(s.to_dict() or {})} for s in self.db.collection("assets").where("isSystem", "==", True).stream()]
        if docs:
            return docs
        # Firestore not seeded yet (scripts/migrate_assets.py): use the bundled catalog
        return [system_asset_doc(i, self.settings.catalog_base_url) for i in load_system_catalog()]

    def user_assets(self, uid: str) -> List[dict]:
        docs = [{"id": s.id, **(s.to_dict() or {})} for s in self.db.collection("assets").where("ownerUid", "==", uid).stream()]
        return [d for d in docs if not d.get("isSystem")]

    def placeable_assets(self, uid: str) -> List[dict]:
        return self.system_assets() + self.user_assets(uid)

    def list(self, scope: str, uid: str) -> List[dict]:
        if scope == "system":
            return self.system_assets()
        out = []
        for a in self.user_assets(uid):
            out.append(self._refresh_urls(a))
        out.sort(key=lambda a: str(a.get("createdAt") or ""), reverse=True)
        return out

    # ------------------------------------------------------------------ signed URLs

    def _sign(self, path: Optional[str]) -> Optional[str]:
        return self.storage.generate_signed_read_url(path, expiration_seconds=SIGNED_URL_TTL) if path else None

    def _url_fields(self, a: dict) -> dict:
        expires = utcnow() + datetime.timedelta(seconds=SIGNED_URL_TTL)
        return {
            "imageUrl": self._sign(a.get("imagePath")),
            "glbUrl": self._sign(a.get("glbPath")),
            "glbWebUrl": None,
            "urlsExpireAt": expires.isoformat(),
        }

    def _refresh_urls(self, a: dict) -> dict:
        """Re-sign a user asset's URLs when they expire within a day (writes back so listeners see them)."""
        if a.get("isSystem"):
            return a
        exp = a.get("urlsExpireAt")
        try:
            remaining = (datetime.datetime.fromisoformat(exp) - utcnow()).total_seconds() if exp else -1
        except ValueError:
            remaining = -1
        if remaining > REFRESH_BEFORE:
            return a
        fields = self._url_fields(a)
        try:
            self._ref(a["id"]).update(fields)
        except Exception as e:
            logger.warning("Could not store refreshed URLs for %s: %s", a["id"], e)
        return {**a, **fields}

    # ------------------------------------------------------------------ upload → Meshy

    def create_upload_url(self, uid: str, file_name: str, content_type: str, size_bytes: Optional[int]) -> dict:
        ctype = (content_type or "").lower()
        if ctype not in PHOTO_TYPES:
            guessed, _ = mimetypes.guess_type(file_name)
            ctype = (guessed or "").lower()
        if ctype not in PHOTO_TYPES:
            raise AppException(status_code=400, code="UNSUPPORTED_FILE_TYPE", detail="Upload a PNG, JPEG or WebP photo")
        if size_bytes and size_bytes > self.settings.MAX_UPLOAD_SIZE_BYTES:
            raise AppException(status_code=400, code="FILE_TOO_LARGE", detail="The photo is larger than 25 MB")
        asset_id = self.db.collection("assets").document().id
        path = f"{uid}/assets/{asset_id}/source{PHOTO_TYPES[ctype]}"
        return {
            "assetId": asset_id,
            "signedUploadUrl": self.storage.generate_signed_upload_url(path, ctype, expiration_seconds=900),
            "contentType": ctype,
        }

    def _find_source(self, uid: str, asset_id: str) -> Optional[str]:
        for ext in sorted(set(PHOTO_TYPES.values())):
            path = f"{uid}/assets/{asset_id}/source{ext}"
            if self.storage.blob_exists(path):
                return path
        return None

    def confirm(
        self,
        uid: str,
        asset_id: str,
        name: str,
        category: str,
        style: Optional[str] = None,
        project_id: Optional[str] = None,
        component_id: Optional[str] = None,
    ) -> dict:
        if self._ref(asset_id).get().exists:
            raise AppException(status_code=409, code="ASSET_EXISTS", detail="This upload was already confirmed")
        source = self._find_source(uid, asset_id)
        if not source:
            raise AppException(status_code=400, code="UPLOAD_NOT_FOUND", detail="The photo upload did not finish")
        if category not in CATALOG_CATEGORIES:
            category = "Other"
        links = []
        if project_id and component_id:
            proj = self.db.collection("projects").document(project_id).get()
            if not proj.exists or (proj.to_dict() or {}).get("ownerUid") != uid:
                raise ForbiddenException(detail="You do not have access to this project", code="PROJECT_ACCESS_DENIED")
            links.append({"projectId": project_id, "componentId": component_id})

        doc = {
            "id": asset_id,
            "ownerUid": uid,
            "isSystem": False,
            "name": name.strip(),
            "category": category,
            "style": style if style in STYLES else None,
            "imagePath": source,
            "glbPath": None,
            "glbWebPath": None,
            "dims": None,
            "frontAxis": "+z",
            "status": "uploaded",
            "progress": 0,
            "error": None,
            "meshyTaskId": None,
            "links": links,
            "createdAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP,
        }
        doc.update(self._url_fields(doc))
        self._ref(asset_id).set(doc)

        for link in links:
            self._link_to_component(link["projectId"], link["componentId"], asset_id, category)

        self._start_generation(asset_id, source)
        return {**doc, **(self.get(asset_id) or {})}

    def _start_generation(self, asset_id: str, source_path: str) -> None:
        if not self.meshy.is_configured:
            self._ref(asset_id).update({"status": "failed", "error": "3D generation is not configured", "updatedAt": SERVER_TIMESTAMP})
            return
        try:
            data = self.storage.download_bytes(source_path)
            ext = os.path.splitext(source_path)[1].lstrip(".").replace("jpg", "jpeg")
            data_uri = f"data:image/{ext};base64,{base64.b64encode(data).decode()}"
            task_id = self.meshy.create_image_to_3d_task(image_url=data_uri)
        except Exception as e:
            logger.warning("Meshy start failed for %s: %s", asset_id, e)
            self._ref(asset_id).update({"status": "failed", "error": f"Could not start 3D generation: {e}", "updatedAt": SERVER_TIMESTAMP})
            return
        self._ref(asset_id).update({"status": "generating_3d", "progress": 1, "meshyTaskId": task_id, "updatedAt": SERVER_TIMESTAMP})
        self.enqueue_poll(asset_id, attempt=0)

    # ------------------------------------------------------------------ polling

    def enqueue_poll(self, asset_id: str, attempt: int, delay: Optional[int] = None) -> None:
        delay = self.settings.MESHY_POLL_INTERVAL_SECONDS if delay is None else delay
        queue = self.settings.MESHY_POLL_QUEUE
        if queue and self.settings.API_PUBLIC_URL:
            from google.cloud import tasks_v2
            from google.protobuf import timestamp_pb2

            base = self.settings.API_PUBLIC_URL.rstrip("/")
            ts = timestamp_pb2.Timestamp()
            ts.FromDatetime(utcnow() + datetime.timedelta(seconds=delay))
            http_request: Dict[str, Any] = {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{base}/internal/assets/{asset_id}/poll",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"attempt": attempt}).encode(),
            }
            if self.settings.TASKS_INVOKER_SA:
                http_request["oidc_token"] = {"service_account_email": self.settings.TASKS_INVOKER_SA, "audience": base}
            tasks_v2.CloudTasksClient().create_task(parent=queue, task={"http_request": http_request, "schedule_time": ts})
            return

        if self.settings.ENV == "testing":
            return

        def loop():  # local dev: poll from a daemon thread
            n = attempt
            while True:
                time.sleep(delay)
                try:
                    if not self.poll(asset_id, n, reenqueue=False):
                        return
                except Exception as e:
                    logger.warning("Local Meshy poll failed for %s: %s", asset_id, e)
                n += 1

        threading.Thread(target=loop, daemon=True).start()

    def poll(self, asset_id: str, attempt: int, reenqueue: bool = True) -> bool:
        """One status check. Returns True while generation is still running."""
        snap = self._ref(asset_id).get()
        if not snap.exists:
            return False
        a = {"id": asset_id, **(snap.to_dict() or {})}
        if a.get("status") != "generating_3d" or not a.get("meshyTaskId"):
            return False
        if attempt >= self.settings.MESHY_POLL_MAX_ATTEMPTS:
            self._ref(asset_id).update({"status": "failed", "error": "3D generation timed out", "updatedAt": SERVER_TIMESTAMP})
            return False
        task = self.meshy.get_task_status(a["meshyTaskId"])
        status = task.get("status")
        if status == "SUCCEEDED":
            self._finalize(a, task)
            return False
        if status in ("FAILED", "CANCELED", "EXPIRED"):
            err = (task.get("task_error") or {}).get("message") or f"Meshy task {status.lower()}"
            self._ref(asset_id).update({"status": "failed", "error": err, "updatedAt": SERVER_TIMESTAMP})
            return False
        progress = max(1, min(99, int(task.get("progress") or 0)))
        self._ref(asset_id).update({"progress": progress, "updatedAt": SERVER_TIMESTAMP})
        if reenqueue:
            self.enqueue_poll(asset_id, attempt + 1)
        return True

    def _finalize(self, a: dict, task: dict) -> None:
        glb_url = (task.get("model_urls") or {}).get("glb")
        if not glb_url:
            self._ref(a["id"]).update({"status": "failed", "error": "Meshy returned no GLB", "updatedAt": SERVER_TIMESTAMP})
            return
        resp = requests.get(glb_url, timeout=120)
        resp.raise_for_status()
        path = f"{a['ownerUid']}/assets/{a['id']}/model.glb"
        self.storage.upload_bytes(resp.content, path, "model/gltf-binary")
        dims = glb_dims(resp.content)
        fields = {"glbPath": path, "dims": dims, "status": "ready", "progress": 100, "error": None, "updatedAt": SERVER_TIMESTAMP}
        fields.update(self._url_fields({**a, **fields}))
        self._ref(a["id"]).update(fields)
        logger.info("Asset %s ready (%d bytes, dims %s)", a["id"], len(resp.content), dims)
        for link in a.get("links") or []:
            try:
                self._refit_linked(link["projectId"], link["componentId"], {**a, **fields})
            except Exception as e:
                logger.warning("Could not refit %s in %s: %s", link, a["id"], e)

    def _link_to_component(self, project_id: str, component_id: str, asset_id: str, category: str) -> None:
        ref = self.db.collection("projects").document(project_id)
        project = ref.get().to_dict() or {}
        mapping = dict(project.get("mapping") or {})
        entry = dict(mapping.get(component_id) or {"label": component_id, "dimsSource": "auto", "skipped": False})
        entry.update({"assetId": asset_id, "category": entry.get("category") or category, "skipped": False})
        entry.setdefault("dims", None)
        entry.setdefault("autoDims", None)
        entry.setdefault("rotationOffset", 0.0)
        mapping[component_id] = entry
        missing = [m for m in project.get("missing") or [] if m.get("componentId") != component_id]
        ref.update({"mapping": mapping, "missing": missing, "updatedAt": SERVER_TIMESTAMP})

    def _refit_linked(self, project_id: str, component_id: str, asset: dict) -> None:
        """The model for a plan box is ready: fit it to its box and resize the placeholder item in 3D."""
        ref = self.db.collection("projects").document(project_id)
        project = ref.get().to_dict() or {}
        entry = (project.get("mapping") or {}).get(component_id)
        if not entry or entry.get("assetId") != asset["id"] or not project.get("floorPlan"):
            return
        entry = refit_entry(project["floorPlan"], component_id, entry, asset)
        ref.update({f"mapping.{component_id}": entry, "updatedAt": SERVER_TIMESTAMP})

        from .scene_ops import SceneService  # local import: avoid a cycle

        scenes = SceneService(self.db, asset_lookup=self.get)
        scene = scenes.get_optional(project_id)
        if not scene:
            return
        item = next((it for it in scene["graph"]["levels"][0]["items"] if it.get("componentId") == component_id), None)
        if item and entry.get("dims"):
            ops: List[dict] = [{"op": "item.resize", "id": item["id"], "dims": entry["dims"]}]
            box = next((b for b in plan_boxes(project["floorPlan"]) if b["id"] == component_id), None)
            if box:
                target = -math.radians(float(box.get("rotation") or 0)) + float(entry.get("rotationOffset") or 0)
                if abs(target - float(item.get("rotationY") or 0)) > 1e-6:
                    ops.append({"op": "item.rotate", "id": item["id"], "rotationY": target})
            scenes.apply_batch(project_id, project["ownerUid"], ops, origin="system", label=f"{asset.get('name')} ready")

    # ------------------------------------------------------------------ edit / delete

    def update(self, user: UserProfile, asset_id: str, patch: Dict[str, Any]) -> dict:
        a = self.get(asset_id)
        if not a or not self._ref(asset_id).get().exists:
            raise NotFoundException(detail="Asset not found", code="ASSET_NOT_FOUND")
        is_admin = user.role == "admin"
        is_owner = a.get("ownerUid") == user.uid
        if not (is_owner or (is_admin and (a.get("isSystem") or patch.get("is_system") is not None))):
            raise ForbiddenException(detail="You cannot edit this asset", code="ASSET_ACCESS_DENIED")

        fields: Dict[str, Any] = {}
        if patch.get("name"):
            fields["name"] = patch["name"].strip()
        if patch.get("category"):
            if patch["category"] not in CATALOG_CATEGORIES:
                raise AppException(status_code=400, code="INVALID_CATEGORY", detail="Unknown category")
            fields["category"] = patch["category"]
        if "style" in patch and patch["style"] is not None:
            if not is_admin:
                raise ForbiddenException(detail="Only admins can set the style", code="ADMIN_REQUIRED")
            if patch["style"] not in STYLES:
                raise AppException(status_code=400, code="INVALID_STYLE", detail="Unknown style")
            fields["style"] = patch["style"]
        if patch.get("is_system") is not None:
            if not is_admin:
                raise ForbiddenException(detail="Only admins can change system assets", code="ADMIN_REQUIRED")
            promote = bool(patch["is_system"])
            if promote and not a.get("isSystem"):
                style = fields.get("style") or a.get("style")
                category = fields.get("category") or a.get("category")
                if style not in STYLES or category not in CATALOG_CATEGORIES:
                    raise AppException(status_code=400, code="STYLE_AND_CATEGORY_REQUIRED",
                                       detail="Pick a style and a category before making this a system asset")
                if a.get("status") != "ready" or not a.get("glbPath"):
                    raise AppException(status_code=409, code="ASSET_NOT_READY", detail="Only ready assets can be promoted")
                fields.update(self._publish_to_catalog(a, style))
            fields["isSystem"] = promote
        if not fields:
            return a
        fields["updatedAt"] = SERVER_TIMESTAMP
        self._ref(asset_id).update(fields)
        return {**a, **fields, "updatedAt": utcnow()}

    def _publish_to_catalog(self, a: dict, style: str) -> Dict[str, Any]:
        """Promoted assets get permanent public URLs: copy GLB + image into the catalog bucket."""
        base = f"assets/{style}/user_{a['id']}"
        ext = os.path.splitext(a.get("imagePath") or ".png")[1] or ".png"
        image_ctype = mimetypes.guess_type(f"x{ext}")[0] or "image/png"
        out: Dict[str, Any] = {"glbWebPath": None, "glbWebUrl": None, "urlsExpireAt": None}
        out["glbUrl"] = self.storage.copy_to_catalog(a["glbPath"], f"{base}.glb", "model/gltf-binary")
        out["glbPath"] = f"{base}.glb"
        if a.get("imagePath"):
            out["imageUrl"] = self.storage.copy_to_catalog(a["imagePath"], f"{base}{ext}", image_ctype)
            out["imagePath"] = f"{base}{ext}"
        return out

    def delete(self, user: UserProfile, asset_id: str) -> None:
        snap = self._ref(asset_id).get()
        if not snap.exists:
            raise NotFoundException(detail="Asset not found", code="ASSET_NOT_FOUND")
        a = snap.to_dict() or {}
        is_owner = a.get("ownerUid") == user.uid
        if not is_owner and not (user.role == "admin" and a.get("isSystem")):
            raise ForbiddenException(detail="You cannot delete this asset", code="ASSET_ACCESS_DENIED")
        if a.get("ownerUid"):
            self.storage.delete_prefix(f"{a['ownerUid']}/assets/{asset_id}/")
        self._ref(asset_id).delete()

    # ------------------------------------------------------------------ background removal

    def remove_background(self, image_bytes: bytes, filename: str, content_type: str, name: str, worker_post) -> str:
        """Proxy to the plan parsing worker (OpenAI image edit); returns a PNG data URI."""
        result = worker_post(image_bytes, filename, content_type, name)
        data_uri = result.get("dataUri")
        if not data_uri:
            raise AppException(status_code=502, code="BACKGROUND_REMOVAL_FAILED", detail="No image came back")
        return data_uri
