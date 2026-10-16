import logging
import os
import warnings
from typing import Optional
import firebase_admin
from firebase_admin import auth, credentials, firestore
from google.cloud import firestore as gcloud_firestore

from google.cloud import storage as gcloud_storage
from google.oauth2 import service_account

from .config import get_settings

logger = logging.getLogger("api.firebase")

# Suppress benign Python version deprecation warnings from google API libraries
warnings.filterwarnings(
    "ignore",
    category=FutureWarning,
    module="google.api_core._python_version_support",
)

_firebase_app: Optional[firebase_admin.App] = None
_firestore_client: Optional[gcloud_firestore.Client] = None
_storage_client: Optional[gcloud_storage.Client] = None


def _find_service_account_path(configured_path: Optional[str]) -> Optional[str]:
    """Resolve FIREBASE_CREDENTIALS_PATH (absolute, or relative to cwd / service dir).

    Returns None when unset so the SDK falls back to Application Default Credentials,
    which is what Cloud Run uses. Key files are never looked up implicitly.
    """
    if not configured_path:
        return None
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for p in (configured_path, os.path.join(base_dir, configured_path)):
        if os.path.isfile(p):
            return os.path.abspath(p)
    logger.warning("FIREBASE_CREDENTIALS_PATH=%s not found; falling back to ADC", configured_path)
    return None


def init_firebase() -> firebase_admin.App:
    """Initialize Firebase Admin SDK with project credentials."""
    global _firebase_app
    if _firebase_app:
        return _firebase_app

    settings = get_settings()

    # Ensure GOOGLE_CLOUD_PROJECT is set so ADC quota/project resolution is accurate
    if settings.FIREBASE_PROJECT_ID and not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        os.environ["GOOGLE_CLOUD_PROJECT"] = settings.FIREBASE_PROJECT_ID

    if not firebase_admin._apps:
        cred = None
        key_path = _find_service_account_path(settings.FIREBASE_CREDENTIALS_PATH)
        if key_path:
            logger.info("Initializing Firebase with credentials from %s", key_path)
            cred = credentials.Certificate(key_path)
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
        settings = get_settings()
        _firestore_client = firestore.client()
    return _firestore_client


def get_auth():
    """Get Firebase Auth module reference."""
    init_firebase()
    return auth


def get_storage_client() -> gcloud_storage.Client:
    """Get or create singleton Google Cloud Storage client."""
    global _storage_client
    if _storage_client is None:
        init_firebase()
        settings = get_settings()
        key_path = _find_service_account_path(settings.FIREBASE_CREDENTIALS_PATH)
        if key_path:
            creds = service_account.Credentials.from_service_account_file(key_path)
            _storage_client = gcloud_storage.Client(
                project=settings.FIREBASE_PROJECT_ID,
                credentials=creds,
            )
        else:
            _storage_client = gcloud_storage.Client(project=settings.FIREBASE_PROJECT_ID)
    return _storage_client
