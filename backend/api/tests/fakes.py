"""In-memory fakes for Firestore, Cloud Storage, Meshy and Gemini used by the API tests."""
import copy
import datetime
import itertools
import random
import string
from typing import Any, Dict, List, Optional

from google.api_core.exceptions import NotFound
from google.cloud.firestore_v1 import transforms

from app.services.gemini_client import FunctionCall, ModelTurn

_clock = itertools.count()


def _now() -> datetime.datetime:
    # strictly increasing so order_by(createdAt) is deterministic
    return datetime.datetime(2026, 10, 16, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=next(_clock))


def _auto_id() -> str:
    return "".join(random.choices(string.ascii_letters + string.digits, k=20))


def _resolve(value: Any, current: Any = None) -> Any:
    if value is transforms.SERVER_TIMESTAMP:
        return _now()
    if isinstance(value, transforms.Increment):
        return (current or 0) + value.value
    if isinstance(value, dict):
        return {k: _resolve(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve(v) for v in value]
    return copy.deepcopy(value)


class Snapshot:
    def __init__(self, ref: "DocRef", data: Optional[dict]):
        self.reference = ref
        self.id = ref.id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> Optional[dict]:
        return copy.deepcopy(self._data) if self._data is not None else None


class DocRef:
    def __init__(self, db: "FakeFirestore", path: str):
        self.db = db
        self.path = path
        self.id = path.rsplit("/", 1)[-1]

    def get(self) -> Snapshot:
        return Snapshot(self, self.db.docs.get(self.path))

    def set(self, data: dict, merge: bool = False) -> None:
        if merge and self.path in self.db.docs:
            cur = self.db.docs[self.path]
            for k, v in data.items():
                cur[k] = _resolve(v, cur.get(k))
        else:
            self.db.docs[self.path] = _resolve(data)

    def update(self, data: dict) -> None:
        if self.path not in self.db.docs:
            raise NotFound(f"No document to update: {self.path}")
        cur = self.db.docs[self.path]
        for key, v in data.items():
            parts = key.split(".")
            target = cur
            for p in parts[:-1]:
                if not isinstance(target.get(p), dict):
                    target[p] = {}
                target = target[p]
            target[parts[-1]] = _resolve(v, target.get(parts[-1]))

    def delete(self) -> None:
        self.db.docs.pop(self.path, None)

    def collection(self, name: str) -> "CollRef":
        return CollRef(self.db, f"{self.path}/{name}")


class CollRef:
    def __init__(self, db: "FakeFirestore", path: str, filters=None, order=None, limit_n=None):
        self.db = db
        self.path = path
        self.filters = filters or []
        self.order = order
        self.limit_n = limit_n

    def document(self, doc_id: Optional[str] = None) -> DocRef:
        return DocRef(self.db, f"{self.path}/{doc_id or _auto_id()}")

    def where(self, *args, filter=None, **kwargs) -> "CollRef":
        if filter is not None:
            f = (filter.field_path, filter.op_string, filter.value)
        else:
            f = (args[0], args[1], args[2])
        return CollRef(self.db, self.path, self.filters + [f], self.order, self.limit_n)

    def order_by(self, field: str, direction: str = "ASCENDING") -> "CollRef":
        return CollRef(self.db, self.path, self.filters, (field, direction), self.limit_n)

    def limit(self, n: int) -> "CollRef":
        return CollRef(self.db, self.path, self.filters, self.order, n)

    def stream(self) -> List[Snapshot]:
        prefix = self.path + "/"
        out = []
        for path, data in list(self.db.docs.items()):
            if not path.startswith(prefix) or "/" in path[len(prefix):]:
                continue
            ok = True
            for field, op, val in self.filters:
                v = data.get(field)
                if op == "==" and v != val:
                    ok = False
                elif op == "in" and v not in val:
                    ok = False
            if ok:
                out.append(Snapshot(DocRef(self.db, path), data))
        if self.order:
            field, direction = self.order
            out.sort(key=lambda s: (s._data.get(field) is None, s._data.get(field) or 0), reverse=direction == "DESCENDING")
        if self.limit_n:
            out = out[: self.limit_n]
        return out


class FakeFirestore:
    def __init__(self):
        self.docs: Dict[str, dict] = {}

    def collection(self, name: str) -> CollRef:
        return CollRef(self, name)

    # helpers for assertions
    def doc(self, path: str) -> Optional[dict]:
        return copy.deepcopy(self.docs.get(path))

    def messages(self, conversation_id: str) -> List[dict]:
        snaps = self.collection("conversations").document(conversation_id).collection("messages").order_by("createdAt").stream()
        return [{"id": s.id, **s.to_dict()} for s in snaps]


class FakeStorage:
    bucket_name = "soraplan-assest-dev"

    def __init__(self):
        self.blobs: Dict[str, bytes] = {}
        self.catalog: Dict[str, bytes] = {}

    def upload_bytes(self, data: bytes, blob_path: str, content_type: str) -> dict:
        self.blobs[blob_path] = data
        return {"gcsUri": f"gs://{self.bucket_name}/{blob_path}", "blobPath": blob_path}

    def download_bytes(self, blob_path: str) -> bytes:
        if blob_path not in self.blobs:
            raise NotFound(blob_path)
        return self.blobs[blob_path]

    def blob_exists(self, blob_path: str) -> bool:
        return blob_path in self.blobs

    def generate_signed_read_url(self, blob_path: str, expiration_seconds: Optional[int] = None) -> str:
        return f"https://signed.example/{blob_path}?exp={expiration_seconds or 86400}"

    def generate_signed_upload_url(self, blob_path: str, content_type: str, expiration_seconds: int = 900) -> str:
        return f"https://signed.example/upload/{blob_path}"

    def delete_blob(self, blob_path: str) -> bool:
        return self.blobs.pop(blob_path, None) is not None

    def delete_prefix(self, prefix: str) -> int:
        keys = [k for k in self.blobs if k.startswith(prefix)]
        for k in keys:
            del self.blobs[k]
        return len(keys)

    def copy_to_catalog(self, blob_path: str, catalog_path: str, content_type: str) -> str:
        self.catalog[catalog_path] = self.blobs[blob_path]
        return f"https://storage.googleapis.com/soraplan-catalog/{catalog_path}"


class FakeMeshy:
    is_configured = True

    def __init__(self):
        self.created: List[str] = []
        self.status: Dict[str, dict] = {}

    def create_image_to_3d_task(self, image_url: str, **kwargs) -> str:
        task_id = f"task_{len(self.created) + 1}"
        self.created.append(image_url)
        self.status[task_id] = {"status": "IN_PROGRESS", "progress": 10}
        return task_id

    def get_task_status(self, task_id: str) -> dict:
        return self.status[task_id]


class FakeGemini:
    """Scripted model: each stream_turn pops the next ModelTurn (text and/or function calls)."""

    def __init__(self, script: Optional[List[ModelTurn]] = None, labels: Optional[Dict[str, Optional[str]]] = None):
        self.script = list(script or [])
        self.labels = labels or {}
        self.calls: List[dict] = []

    def stream_turn(self, system, history, tools, on_text, should_stop=lambda: False, temperature=0.4) -> ModelTurn:
        self.calls.append({"system": system, "history": copy.deepcopy([h for h in history if h["role"] != "model"]),
                           "tools": [t["name"] for t in tools]})
        turn = self.script.pop(0) if self.script else ModelTurn(text="Okay.")
        if turn.text:
            on_text(turn.text)
        return turn

    def classify_labels(self, items, categories):
        return {i["id"]: self.labels.get(i["label"]) for i in items}


def say(text: str) -> ModelTurn:
    return ModelTurn(text=text)


def call(name: str, **args) -> ModelTurn:
    return ModelTurn(calls=[FunctionCall(name=name, args=args, id=f"c_{name}")], parts=[f"part:{name}"])
