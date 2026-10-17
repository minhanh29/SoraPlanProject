"""Small helpers shared by the chat-first services."""
import datetime
import json
import os
from functools import lru_cache
from typing import Any, Dict, List

from firebase_admin import firestore

from ..errors import ForbiddenException, NotFoundException

SERVER_TIMESTAMP = firestore.SERVER_TIMESTAMP
_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def get_owned(db, collection: str, doc_id: str, uid: str, what: str = "Project") -> Dict[str, Any]:
    """Fetch a document and check `ownerUid`; raises 404 / 403 with problem-details codes."""
    snap = db.collection(collection).document(doc_id).get()
    if not snap.exists:
        raise NotFoundException(detail=f"{what} not found", code=f"{what.upper()}_NOT_FOUND")
    data = snap.to_dict() or {}
    if data.get("ownerUid") != uid:
        raise ForbiddenException(detail=f"You do not have access to this {what.lower()}", code=f"{what.upper()}_ACCESS_DENIED")
    data.setdefault("id", doc_id)
    return data


@lru_cache()
def load_styles() -> Dict[str, Dict[str, Any]]:
    with open(os.path.join(_DATA_DIR, "styles.json"), encoding="utf-8") as f:
        return json.load(f)


@lru_cache()
def load_system_catalog() -> List[Dict[str, Any]]:
    """The preset catalog shipped with the service (same ids as Firestore assets/sys_*)."""
    with open(os.path.join(_DATA_DIR, "system_assets.json"), encoding="utf-8") as f:
        return json.load(f)
