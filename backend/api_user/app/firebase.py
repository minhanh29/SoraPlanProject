import logging
import os
import warnings
from typing import Optional
import firebase_admin
from firebase_admin import auth, credentials, firestore
from google.cloud import firestore as gcloud_firestore

from .config import get_settings

logger = logging.getLogger("api_user.firebase")

# Suppress benign Python version deprecation warnings from google API libraries
warnings.filterwarnings(
    "ignore",
    category=FutureWarning,
    module="google.api_core._python_version_support",
)

_firebase_app: Optional[firebase_admin.App] = None
_firestore_client: Optional[gcloud_firestore.Client] = None


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
        if settings.FIREBASE_CREDENTIALS_PATH and os.path.exists(settings.FIREBASE_CREDENTIALS_PATH):
            logger.info("Initializing Firebase with credentials from %s", settings.FIREBASE_CREDENTIALS_PATH)
            cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
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
