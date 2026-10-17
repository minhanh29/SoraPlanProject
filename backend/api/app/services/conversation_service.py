"""conversations/{id} (1:1 with projects/{id}) and their messages subcollection."""
import logging
from typing import Any, Dict, List, Optional

from google.cloud.firestore import Query

from .common import SERVER_TIMESTAMP, get_owned

logger = logging.getLogger("api.conversation_service")

# Sidebar preview for template messages (the full copy lives in web/src/chat/messageTemplates.ts)
PREVIEWS = {
    "crop_request": "Crop your floor plan",
    "parse_started": "Reading your floor plan…",
    "plan_ready": "Your plan is ready",
    "plan_failed": "We couldn't read the plan",
    "style_picker": "Pick a style",
    "mapping_result": "Some objects need a model",
    "scene_ready": "Your 3D home is ready",
    "scene_change": "Scene updated",
    "error": "Something went wrong",
}


class ConversationService:
    def __init__(self, db):
        self.db = db

    def _ref(self, conversation_id: str):
        return self.db.collection("conversations").document(conversation_id)

    def get(self, conversation_id: str, uid: str) -> Dict[str, Any]:
        return get_owned(self.db, "conversations", conversation_id, uid, what="Conversation")

    def create(self, conversation_id: str, uid: str, title: str) -> Dict[str, Any]:
        data = {
            "id": conversation_id,
            "ownerUid": uid,
            "projectId": conversation_id,
            "title": title,
            "stage": "uploading",
            "stageData": {},
            "busy": False,
            "busyReason": None,
            "cancelRequested": False,
            "lastMessageAt": None,
            "lastMessagePreview": "",
            "thumbnailUrl": None,
            "createdAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP,
        }
        self._ref(conversation_id).set(data)
        return data

    def update(self, conversation_id: str, **fields: Any) -> None:
        fields["updatedAt"] = SERVER_TIMESTAMP
        self._ref(conversation_id).update(fields)

    def set_thumbnail(self, conversation_id: str, **fields: Any) -> None:
        """Thumbnail fields only: leaves updatedAt alone so the sidebar order does not change."""
        self._ref(conversation_id).update(fields)

    def set_stage(self, conversation_id: str, stage: str, **extra: Any) -> None:
        logger.info("Conversation %s → stage %s", conversation_id, stage)
        self.update(conversation_id, stage=stage, **extra)

    def set_busy(self, conversation_id: str, busy: bool, reason: Optional[str] = None) -> None:
        self.update(conversation_id, busy=busy, busyReason=reason if busy else None, cancelRequested=False)

    def append_message(
        self,
        conversation_id: str,
        role: str,
        kind: str = "text",
        text: str = "",
        payload: Optional[Dict[str, Any]] = None,
        status: str = "done",
        tool_calls: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        ref = self._ref(conversation_id).collection("messages").document()
        doc: Dict[str, Any] = {
            "role": role,
            "kind": kind,
            "text": text,
            "payload": payload or {},
            "status": status,
            "createdAt": SERVER_TIMESTAMP,
        }
        if tool_calls:
            doc["toolCalls"] = tool_calls
        ref.set(doc)
        preview = (text or PREVIEWS.get(kind, "")).strip().replace("\n", " ")[:140]
        if preview:
            self.update(conversation_id, lastMessageAt=SERVER_TIMESTAMP, lastMessagePreview=preview)
        return ref.id

    def update_message(self, conversation_id: str, message_id: str, **fields: Any) -> None:
        self._ref(conversation_id).collection("messages").document(message_id).update(fields)

    def recent_messages(self, conversation_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        snaps = (
            self._ref(conversation_id)
            .collection("messages")
            .order_by("createdAt", direction=Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        msgs = [{"id": s.id, **(s.to_dict() or {})} for s in snaps]
        msgs.reverse()
        return msgs

    def is_cancel_requested(self, conversation_id: str) -> bool:
        snap = self._ref(conversation_id).get()
        return bool(snap.exists and (snap.to_dict() or {}).get("cancelRequested"))

    def delete(self, conversation_id: str) -> None:
        ref = self._ref(conversation_id)
        for s in ref.collection("messages").stream():
            s.reference.delete()
        ref.delete()
