"""Sample projects for new accounts: a full copy of SAMPLE_PROJECT_IDS into the user's own projects.

New user docs start with samples="pending"; the web app calls POST /v1/users/me/samples once after sign-in.
Everything is copied as if the user had made it: project (+ floorPlans), conversation (+ messages),
scene (+ ops), the parse job, the user-owned 3D assets the scene uses, and their Storage files.

Copies get ids derived from (uid, source id), so a retry after a failure or two racing calls overwrite the
same docs instead of creating duplicates. Accounts created before this existed have no `samples` field
and never get samples.
"""
import base64
import datetime
import hashlib
import logging
from typing import Any, Dict, List, Optional

from .asset_service import SIGNED_URL_TTL, _in_catalog
from .common import SERVER_TIMESTAMP, utcnow
from .storage_service import StorageService

logger = logging.getLogger("api.sample_service")

PENDING, COPYING, DONE = "pending", "copying", "done"
CLAIM_STALE_SECONDS = 300  # a copy that crashed mid-way can be claimed again after this

# (parent collection, subcollections) for each per-project doc; all three share the project id
PROJECT_DOCS = (("projects", ("floorPlans",)), ("scenes", ("ops",)), ("conversations", ("messages",)))


def _copy_id(uid: str, source_id: str) -> str:
    """20 url-safe chars, stable per (user, source)."""
    digest = hashlib.sha256(f"sample:{uid}:{source_id}".encode()).digest()
    return base64.urlsafe_b64encode(digest).decode()[:20].replace("-", "x").replace("_", "y")


def _rewrite(value: Any, ids: Dict[str, str]) -> Any:
    """Deep copy with every old id (owner uid, project, job, asset) replaced inside strings and keys."""
    if isinstance(value, str):
        for old, new in ids.items():
            if old in value:
                value = value.replace(old, new)
        return value
    if isinstance(value, dict):
        return {_rewrite(k, ids): _rewrite(v, ids) for k, v in value.items()}
    if isinstance(value, list):
        return [_rewrite(v, ids) for v in value]
    return value


class SampleService:
    def __init__(self, db, storage: StorageService, sample_ids: List[str]):
        self.db = db
        self.storage = storage
        self.sample_ids = [s for s in sample_ids if s]

    # ------------------------------------------------------------------ entry point

    def ensure_samples(self, uid: str) -> Dict[str, Any]:
        """Copy the samples once per new account. Safe to call on every load."""
        ref = self.db.collection("users").document(uid)
        user = ref.get().to_dict() or {}
        state = user.get("samples")
        if state == COPYING and not self._stale(user.get("samplesClaimedAt")):
            return {"status": COPYING, "projectIds": []}
        if state not in (PENDING, COPYING):
            return {"status": state or "none", "projectIds": user.get("sampleProjectIds") or []}

        ref.update({"samples": COPYING, "samplesClaimedAt": utcnow().isoformat()})
        try:
            ids = [pid for src in self.sample_ids if (pid := self.copy_project(src, uid))]
        except Exception:
            logger.exception("Copying sample projects for %s failed", uid)
            ref.update({"samples": PENDING})  # the next load tries again (same ids, so no duplicates)
            raise
        ref.update({"samples": DONE, "sampleProjectIds": ids, "samplesCopiedAt": SERVER_TIMESTAMP})
        logger.info("Copied %d sample projects to %s", len(ids), uid)
        return {"status": DONE, "projectIds": ids}

    @staticmethod
    def _stale(claimed_at: Optional[str]) -> bool:
        try:
            return (utcnow() - datetime.datetime.fromisoformat(claimed_at)).total_seconds() > CLAIM_STALE_SECONDS
        except (TypeError, ValueError):
            return True

    # ------------------------------------------------------------------ copy

    def copy_project(self, source_id: str, uid: str) -> Optional[str]:
        project = self.db.collection("projects").document(source_id).get().to_dict()
        if not project:
            logger.warning("Sample project %s not found, skipped", source_id)
            return None
        owner = project.get("ownerUid")
        if owner == uid:
            return None  # the sample author already has it
        new_id = _copy_id(uid, source_id)
        ids: Dict[str, str] = {source_id: new_id, owner: uid}

        jobs = list(self.db.collection("jobs").where("projectId", "==", source_id).stream())
        for job in jobs:
            ids[job.id] = _copy_id(uid, job.id)
        assets = self._own_assets(project, owner)
        for asset_id in assets:
            ids[asset_id] = _copy_id(uid, asset_id)

        # Files first, docs that make the project visible (conversation) last
        self.storage.copy_prefix(f"{owner}/{source_id}/", f"{uid}/{new_id}/")
        for asset_id, asset in assets.items():
            self._copy_asset(asset_id, asset, owner, uid, ids)
        for job in jobs:
            doc = _rewrite(job.to_dict() or {}, ids)
            if isinstance(doc.get("input"), dict):
                doc["input"]["signedUrl"] = None  # pointed at the old file; the job is finished anyway
            self.db.collection("jobs").document(ids[job.id]).set(doc)
        for collection, subs in PROJECT_DOCS:
            src = self.db.collection(collection).document(source_id)
            dst = self.db.collection(collection).document(new_id)
            data = src.get().to_dict()
            if data is None:
                continue
            for sub in subs:
                for snap in src.collection(sub).stream():
                    dst.collection(sub).document(snap.id).set(_rewrite(snap.to_dict() or {}, ids))
            doc = _rewrite(data, ids)
            if collection == "projects":
                doc["sampleOf"] = source_id
            if collection == "conversations":
                doc.update(self._fresh_conversation(project, ids))
            dst.set(doc)
        return new_id

    def _fresh_conversation(self, project: dict, ids: Dict[str, str]) -> Dict[str, Any]:
        out: Dict[str, Any] = {"busy": False, "busyReason": None, "cancelRequested": False}
        thumb = project.get("thumbnailPath")
        if thumb:
            out["thumbnailUrl"] = self.storage.generate_signed_read_url(_rewrite(thumb, ids), expiration_seconds=SIGNED_URL_TTL)
            out["thumbnailExpiresAt"] = (utcnow() + datetime.timedelta(seconds=SIGNED_URL_TTL)).isoformat()
        return out

    def _own_assets(self, project: dict, owner: str) -> Dict[str, dict]:
        """The source owner's private 3D models used by this project (catalog assets are shared as-is)."""
        used = {e.get("assetId") for e in (project.get("mapping") or {}).values() if isinstance(e, dict)}
        scene = self.db.collection("scenes").document(project["id"]).get().to_dict() or {}
        for level in (scene.get("graph") or {}).get("levels") or []:
            used |= {i.get("assetId") for i in level.get("items") or []}
        out = {}
        for asset_id in sorted(a for a in used if a):
            a = self.db.collection("assets").document(asset_id).get().to_dict()
            if a and a.get("ownerUid") == owner and not _in_catalog(a):
                out[asset_id] = a
        return out

    def _copy_asset(self, asset_id: str, asset: dict, owner: str, uid: str, ids: Dict[str, str]) -> None:
        new_id = ids[asset_id]
        self.storage.copy_prefix(f"{owner}/assets/{asset_id}/", f"{uid}/assets/{new_id}/")
        doc = _rewrite(asset, ids)
        doc.update({
            "id": new_id,
            "ownerUid": uid,
            "isSystem": False,
            "meshyTaskId": None,
            # only links into projects this copy owns
            "links": [l for l in doc.get("links") or [] if l.get("projectId") in ids.values()],
        })
        expires = utcnow() + datetime.timedelta(seconds=SIGNED_URL_TTL)
        for path_key, url_key in (("imagePath", "imageUrl"), ("glbPath", "glbUrl"), ("thumbPath", "thumbUrl")):
            path = doc.get(path_key)
            doc[url_key] = self.storage.generate_signed_read_url(path, expiration_seconds=SIGNED_URL_TTL) if path else None
        doc["urlsExpireAt"] = expires.isoformat()
        self.db.collection("assets").document(new_id).set(doc)
