import logging
import os
import warnings
from typing import Optional
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import firestore as gcloud_firestore
from google.cloud import storage as gcloud_storage
from google.oauth2 import service_account

from .config import get_settings

logger = logging.getLogger("api_plan_parser.firebase")

warnings.filterwarnings(
    "ignore",
    category=FutureWarning,
    module="google.api_core._python_version_support",
)

_firebase_app: Optional[firebase_admin.App] = None
_firestore_client: Optional[gcloud_firestore.Client] = None
_storage_client: Optional[gcloud_storage.Client] = None


def _find_service_account_path(configured_path: Optional[str]) -> Optional[str]:
    """Resolve service account JSON key file from various possible paths."""
    candidates = []
    if configured_path:
        candidates.append(configured_path)
        candidates.append(os.path.abspath(configured_path))

    # Common relative paths in workspace
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # api_plan_parser
    workspace_root = os.path.dirname(os.path.dirname(base_dir)) # SoraPlan
    candidates.extend([
        os.path.join(base_dir, ".secrets", "serviceAccountKey.json"),
        os.path.join(workspace_root, "backend", "api_user", ".secrets", "serviceAccountKey.json"),
        os.path.join(os.getcwd(), "backend", "api_user", ".secrets", "serviceAccountKey.json"),
        os.path.join(os.getcwd(), ".secrets", "serviceAccountKey.json"),
    ])

    for p in candidates:
        if p and os.path.exists(p) and os.path.isfile(p):
            return p
    return None


def init_firebase() -> firebase_admin.App:
    """Initialize Firebase Admin SDK with project credentials."""
    global _firebase_app
    if _firebase_app:
        return _firebase_app

    settings = get_settings()

    if settings.FIREBASE_PROJECT_ID and not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        os.environ["GOOGLE_CLOUD_PROJECT"] = settings.FIREBASE_PROJECT_ID

    if not firebase_admin._apps:
        cred = None
        sa_path = _find_service_account_path(settings.FIREBASE_CREDENTIALS_PATH)
        if sa_path:
            logger.info("Initializing Firebase with credentials from %s", sa_path)
            cred = credentials.Certificate(sa_path)
        else:
            try:
                cred = credentials.ApplicationDefault()
                logger.info("Initializing Firebase with Application Default Credentials")
            except Exception as e:
                logger.warning("Could not load Application Default Credentials: %s. Using default init.", e)

        options = {"projectId": settings.FIREBASE_PROJECT_ID}
        if cred:
            _firebase_app = firebase_admin.initialize_app(cred, options=options)
        else:
            _firebase_app = firebase_admin.initialize_app(options=options)
    else:
        _firebase_app = firebase_admin.get_app()

    return _firebase_app


def get_firestore_client() -> gcloud_firestore.Client:
    """Get or create singleton Firestore client."""
    global _firestore_client
    if _firestore_client is None:
        init_firebase()
        _firestore_client = firestore.client()
    return _firestore_client


def get_storage_client() -> gcloud_storage.Client:
    """Get or create singleton Google Cloud Storage client."""
    global _storage_client
    if _storage_client is None:
        init_firebase()
        settings = get_settings()
        sa_path = _find_service_account_path(settings.FIREBASE_CREDENTIALS_PATH)
        if sa_path:
            creds = service_account.Credentials.from_service_account_file(sa_path)
            _storage_client = gcloud_storage.Client(
                project=settings.FIREBASE_PROJECT_ID,
                credentials=creds,
            )
        else:
            _storage_client = gcloud_storage.Client(project=settings.FIREBASE_PROJECT_ID)
    return _storage_client
