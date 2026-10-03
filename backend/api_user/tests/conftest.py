import os
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

# Set test environment variables before importing app
os.environ["ENV"] = "testing"
os.environ["FIREBASE_PROJECT_ID"] = "soraplan"
os.environ["FIREBASE_WEB_API_KEY"] = "fake-api-key"

from app.deps import (
    get_auth_service,
    get_current_token_payload,
    get_current_user,
    get_db,
    get_user_service,
)
from app.main import app
from app.models.user import UserProfile, UserQuota
from app.services.auth_service import AuthService
from app.services.user_service import UserService


@pytest.fixture
def mock_firestore():
    """Mock Firestore client and stateful document store."""
    mock_db = MagicMock()
    mock_collection = MagicMock()
    docs_store = {
        "usr_test123": {
            "uid": "usr_test123",
            "email": "test@soraplan.com",
            "displayName": "Test User",
            "photoUrl": "https://example.com/avatar.jpg",
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
        }
    }

    def get_doc(doc_id):
        mock_doc = MagicMock()

        def mock_get():
            snap = MagicMock()
            if doc_id in docs_store:
                snap.exists = True
                snap.to_dict.return_value = dict(docs_store[doc_id])
            else:
                snap.exists = False
                snap.to_dict.return_value = None
            return snap

        def mock_set(data):
            docs_store[doc_id] = dict(data)

        def mock_update(data):
            if doc_id in docs_store:
                docs_store[doc_id].update(data)

        mock_doc.get.side_effect = mock_get
        mock_doc.set.side_effect = mock_set
        mock_doc.update.side_effect = mock_update
        return mock_doc

    mock_db.collection.return_value = mock_collection
    mock_collection.document.side_effect = get_doc
    return mock_db


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
def client(mock_firestore, sample_user_profile):
    """Test client with mocked dependencies."""
    user_service = UserService(db=mock_firestore)
    auth_service = AuthService(user_service=user_service)

    app.dependency_overrides[get_db] = lambda: mock_firestore
    app.dependency_overrides[get_user_service] = lambda: user_service
    app.dependency_overrides[get_auth_service] = lambda: auth_service
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
