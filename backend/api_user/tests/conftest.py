import os
import random
import string
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

# Set test environment variables before importing app
os.environ["ENV"] = "testing"
os.environ["FIREBASE_PROJECT_ID"] = "soraplan"
os.environ["FIREBASE_WEB_API_KEY"] = "fake-api-key"
os.environ["GCS_BUCKET_NAME"] = "soraplan-assest-dev"

from app.deps import (
    get_auth_service,
    get_current_token_payload,
    get_current_user,
    get_db,
    get_project_service,
    get_storage_service,
    get_user_service,
)
from app.main import app
from app.models.user import UserProfile, UserQuota
from app.services.auth_service import AuthService
from app.services.project_service import ProjectService
from app.services.storage_service import StorageService
from app.services.user_service import UserService


def generate_gcloud_id() -> str:
    """Generate 20-char base62 string adhering to Google Cloud Firestore auto-ID format."""
    chars = string.ascii_letters + string.digits
    return "".join(random.choices(chars, k=20))


@pytest.fixture
def mock_firestore():
    """Mock Firestore client and stateful document store with subcollection support."""
    mock_db = MagicMock()
    
    # Store: collection -> doc_id -> data dict
    store = {
        "users": {
            "usr_test123": {
                "uid": "usr_test123",
                "email": "test@soraplan.com",
                "displayName": "Test User",
                "photoUrl": "https://example.com/avatar.jpg",
                "role": "user",
                "plan": "free",
                "quota": {
                    "projects": 5,
                    "rendersFinal": 20,
                    "rendersDraft": 100,
                    "assets3d": 10,
                    "planParses": 20,
                    "resetAt": None,
                },
                "emailVerified": True,
            },
            "tPST7GIKXTQaTiBOQH4hl7zIHxS2": {
                "uid": "tPST7GIKXTQaTiBOQH4hl7zIHxS2",
                "email": "admin@soraplan.com",
                "displayName": "Admin User",
                "photoUrl": "https://example.com/admin.jpg",
                "role": "admin",
                "plan": "free",
                "quota": {
                    "projects": 5,
                    "rendersFinal": 20,
                    "rendersDraft": 100,
                    "assets3d": 10,
                    "planParses": 20,
                    "resetAt": None,
                },
                "emailVerified": True,
            },
        },
        "projects": {},
        "planImages": {},
    }

    def create_doc_mock(coll_name: str, doc_id: str):
        mock_doc = MagicMock()
        mock_doc.id = doc_id

        def mock_get():
            snap = MagicMock()
            if coll_name in store and doc_id in store[coll_name]:
                snap.exists = True
                snap.to_dict.return_value = dict(store[coll_name][doc_id])
            else:
                snap.exists = False
                snap.to_dict.return_value = None
            return snap

        def mock_set(data):
            if coll_name not in store:
                store[coll_name] = {}
            store[coll_name][doc_id] = dict(data)

        def mock_update(data):
            if coll_name in store and doc_id in store[coll_name]:
                store[coll_name][doc_id].update(data)

        def mock_delete():
            if coll_name in store and doc_id in store[coll_name]:
                del store[coll_name][doc_id]

        def get_subcollection(sub_coll_name: str):
            mock_sub = MagicMock()

            def get_sub_doc(sub_doc_id=None):
                sub_id = sub_doc_id or generate_gcloud_id()
                return create_doc_mock(f"{coll_name}_{doc_id}_{sub_coll_name}", sub_id)

            def sub_stream():
                full_coll = f"{coll_name}_{doc_id}_{sub_coll_name}"
                snaps = []
                for s_id, s_data in store.get(full_coll, {}).items():
                    s_snap = MagicMock()
                    s_snap.id = s_id
                    s_snap.to_dict.return_value = dict(s_data)
                    s_snap.reference = create_doc_mock(full_coll, s_id)
                    snaps.append(s_snap)
                return snaps

            mock_sub.document.side_effect = get_sub_doc
            mock_sub.stream.side_effect = sub_stream
            return mock_sub

        mock_doc.get.side_effect = mock_get
        mock_doc.set.side_effect = mock_set
        mock_doc.update.side_effect = mock_update
        mock_doc.delete.side_effect = mock_delete
        mock_doc.collection.side_effect = get_subcollection
        return mock_doc

    def get_collection(coll_name: str):
        mock_coll = MagicMock()

        def get_doc(doc_id=None):
            actual_id = doc_id if doc_id else generate_gcloud_id()
            return create_doc_mock(coll_name, actual_id)

        def query_where(*args, **kwargs):
            mock_query = MagicMock()
            if "filter" in kwargs:
                f = kwargs["filter"]
                field = getattr(f, "field_path", "ownerUid")
                op = getattr(f, "op_string", "==")
                val = getattr(f, "value", None)
            elif len(args) >= 3:
                field, op, val = args[0], args[1], args[2]
            else:
                field, op, val = "ownerUid", "==", None

            def stream_results():
                results = []
                for d_id, data in store.get(coll_name, {}).items():
                    if op == "==" and data.get(field) == val:
                        snap = MagicMock()
                        snap.id = d_id
                        snap.to_dict.return_value = dict(data)
                        results.append(snap)
                return results

            mock_query.stream.side_effect = stream_results
            return mock_query

        mock_coll.document.side_effect = get_doc
        mock_coll.where.side_effect = query_where
        return mock_coll

    mock_db.collection.side_effect = get_collection
    return mock_db


@pytest.fixture
def mock_storage_service():
    """Mock storage service that tracks uploaded blobs in memory and simulates signed URLs."""
    storage_mock = MagicMock(spec=StorageService)
    storage_mock.bucket_name = "soraplan-assest-dev"
    blobs = {}

    def upload_bytes(data: bytes, blob_path: str, content_type: str):
        blobs[blob_path] = {"data": data, "content_type": content_type}
        return {
            "bucket": "soraplan-assest-dev",
            "blobPath": blob_path,
            "sizeBytes": len(data),
            "contentType": content_type,
            "gcsUri": f"gs://soraplan-assest-dev/{blob_path}",
        }

    def generate_signed_read_url(blob_path: str, expiration_seconds: int = 86400):
        return (
            f"https://storage.googleapis.com/soraplan-assest-dev/{blob_path}"
            f"?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires={expiration_seconds}&X-Goog-Signed=mock_sig"
        )

    def generate_signed_upload_url(blob_path: str, content_type: str, expiration_seconds: int = 900):
        return (
            f"https://storage.googleapis.com/soraplan-assest-dev/{blob_path}"
            f"?X-Goog-Algorithm=GOOG4-RSA-SHA256&action=upload&X-Goog-Expires={expiration_seconds}"
        )

    def blob_exists(blob_path: str):
        return blob_path in blobs

    def delete_blob(blob_path: str):
        if blob_path in blobs:
            del blobs[blob_path]
            return True
        return False

    def delete_prefix(prefix: str):
        keys = [k for k in list(blobs.keys()) if k.startswith(prefix)]
        for k in keys:
            del blobs[k]
        return len(keys)

    storage_mock.upload_bytes.side_effect = upload_bytes
    storage_mock.generate_signed_read_url.side_effect = generate_signed_read_url
    storage_mock.generate_signed_upload_url.side_effect = generate_signed_upload_url
    storage_mock.blob_exists.side_effect = blob_exists
    storage_mock.delete_blob.side_effect = delete_blob
    storage_mock.delete_prefix.side_effect = delete_prefix
    return storage_mock


@pytest.fixture
def sample_user_profile():
    return UserProfile(
        uid="usr_test123",
        email="test@soraplan.com",
        display_name="Test User",
        photo_url="https://example.com/avatar.jpg",
        plan="free",
        quota=UserQuota(
            projects=5,
            renders_final=20,
            renders_draft=100,
            assets3d=10,
            plan_parses=20,
        ),
        email_verified=True,
    )


@pytest.fixture
def client(mock_firestore, mock_storage_service, sample_user_profile):
    """Test client with mocked dependencies."""
    user_service = UserService(db=mock_firestore)
    auth_service = AuthService(user_service=user_service)
    project_service = ProjectService(db=mock_firestore, storage_service=mock_storage_service)

    app.dependency_overrides[get_db] = lambda: mock_firestore
    app.dependency_overrides[get_user_service] = lambda: user_service
    app.dependency_overrides[get_auth_service] = lambda: auth_service
    app.dependency_overrides[get_storage_service] = lambda: mock_storage_service
    app.dependency_overrides[get_project_service] = lambda: project_service
    app.dependency_overrides[get_current_token_payload] = lambda: {
        "uid": "usr_test123",
        "email": "test@soraplan.com",
        "name": "Test User",
        "picture": "https://example.com/avatar.jpg",
        "email_verified": True,
    }
    app.dependency_overrides[get_current_user] = lambda: sample_user_profile

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def admin_user_profile():
    return UserProfile(
        uid="tPST7GIKXTQaTiBOQH4hl7zIHxS2",
        email="admin@soraplan.com",
        display_name="Admin User",
        photo_url="https://example.com/admin.jpg",
        role="admin",
        plan="free",
        quota=UserQuota(
            projects=5,
            renders_final=20,
            renders_draft=100,
            assets3d=10,
            plan_parses=20,
        ),
        email_verified=True,
    )


@pytest.fixture
def admin_client(mock_firestore, mock_storage_service, admin_user_profile):
    """Test client with mocked dependencies authenticated as Admin user."""
    user_service = UserService(db=mock_firestore)
    auth_service = AuthService(user_service=user_service)
    project_service = ProjectService(db=mock_firestore, storage_service=mock_storage_service)

    app.dependency_overrides[get_db] = lambda: mock_firestore
    app.dependency_overrides[get_user_service] = lambda: user_service
    app.dependency_overrides[get_auth_service] = lambda: auth_service
    app.dependency_overrides[get_storage_service] = lambda: mock_storage_service
    app.dependency_overrides[get_project_service] = lambda: project_service
    app.dependency_overrides[get_current_token_payload] = lambda: {
        "uid": "tPST7GIKXTQaTiBOQH4hl7zIHxS2",
        "email": "admin@soraplan.com",
        "name": "Admin User",
        "picture": "https://example.com/admin.jpg",
        "email_verified": True,
    }
    app.dependency_overrides[get_current_user] = lambda: admin_user_profile

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()

