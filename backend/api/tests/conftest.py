import os

import pytest
from fastapi.testclient import TestClient

# Test environment before importing the app
os.environ["ENV"] = "testing"
os.environ["FIREBASE_PROJECT_ID"] = "soraplan"
os.environ["GCS_BUCKET_NAME"] = "soraplan-assest-dev"
os.environ.pop("MESHY_POLL_QUEUE", None)
os.environ.pop("CLOUD_TASKS_QUEUE", None)

from app.deps import (  # noqa: E402
    get_current_token_payload,
    get_current_user,
    get_db,
    get_gemini,
    get_meshy_service,
    get_storage_service,
)
from app.main import app  # noqa: E402
from app.models.user import UserProfile, UserQuota  # noqa: E402

from .fakes import FakeFirestore, FakeGemini, FakeMeshy, FakeStorage  # noqa: E402

USER_UID = "usr_test123"
ADMIN_UID = "tPST7GIKXTQaTiBOQH4hl7zIHxS2"


def _quota_doc():
    return {"projects": 5, "rendersFinal": 20, "rendersDraft": 100, "assets3d": 10, "planParses": 20, "resetAt": None}


@pytest.fixture
def fake_db():
    db = FakeFirestore()
    db.collection("users").document(USER_UID).set({
        "uid": USER_UID, "email": "test@soraplan.com", "displayName": "Test User",
        "photoUrl": "https://example.com/avatar.jpg", "role": "user", "plan": "free",
        "quota": _quota_doc(), "emailVerified": True,
    })
    db.collection("users").document(ADMIN_UID).set({
        "uid": ADMIN_UID, "email": "admin@soraplan.com", "displayName": "Admin User",
        "photoUrl": "https://example.com/admin.jpg", "role": "admin", "plan": "free",
        "quota": _quota_doc(), "emailVerified": True,
    })
    return db


@pytest.fixture
def fake_storage():
    return FakeStorage()


@pytest.fixture
def fake_meshy():
    return FakeMeshy()


@pytest.fixture
def fake_gemini():
    return FakeGemini()


@pytest.fixture
def worker_calls(monkeypatch):
    """Capture direct worker dispatches instead of making HTTP calls."""
    calls = []

    class _Resp:
        status_code = 200

    def fake_post(url, json=None, **kwargs):
        calls.append({"url": url, "json": json})
        return _Resp()

    monkeypatch.setattr("requests.post", fake_post)
    return calls


def _profile(uid: str, role: str) -> UserProfile:
    return UserProfile(
        uid=uid,
        email="admin@soraplan.com" if role == "admin" else "test@soraplan.com",
        display_name="Admin User" if role == "admin" else "Test User",
        photo_url="https://example.com/avatar.jpg",
        role=role,
        plan="free",
        quota=UserQuota(projects=5, renders_final=20, renders_draft=100, assets3d=10, plan_parses=20),
        email_verified=True,
    )


@pytest.fixture
def sample_user_profile():
    return _profile(USER_UID, "user")


@pytest.fixture
def admin_user_profile():
    return _profile(ADMIN_UID, "admin")


def _client(db, storage, meshy, gemini, profile):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage_service] = lambda: storage
    app.dependency_overrides[get_meshy_service] = lambda: meshy
    app.dependency_overrides[get_gemini] = lambda: gemini
    app.dependency_overrides[get_current_token_payload] = lambda: {"uid": profile.uid, "email": profile.email}
    app.dependency_overrides[get_current_user] = lambda: profile
    return TestClient(app)


@pytest.fixture
def client(fake_db, fake_storage, fake_meshy, fake_gemini, sample_user_profile, worker_calls):
    with _client(fake_db, fake_storage, fake_meshy, fake_gemini, sample_user_profile) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def admin_client(fake_db, fake_storage, fake_meshy, fake_gemini, admin_user_profile, worker_calls):
    with _client(fake_db, fake_storage, fake_meshy, fake_gemini, admin_user_profile) as c:
        yield c
    app.dependency_overrides.clear()


AUTH = {"Authorization": "Bearer test"}
