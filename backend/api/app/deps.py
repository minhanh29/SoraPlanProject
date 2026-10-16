import logging
from typing import Generator
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as fb_auth
from google.cloud import firestore as gcloud_firestore

from google.cloud import storage as gcloud_storage

from .errors import UnauthorizedException
from .firebase import get_auth, get_firestore_client, get_storage_client
from .models.user import UserProfile
from .services.auth_service import AuthService
from .services.user_service import UserService
from .services.storage_service import StorageService
from .services.project_service import ProjectService
from .services.meshy_service import MeshyService

logger = logging.getLogger("api.deps")
bearer_scheme = HTTPBearer(auto_error=True)


def get_db() -> gcloud_firestore.Client:
    """Dependency for Firestore client."""
    return get_firestore_client()


def get_user_service(db: gcloud_firestore.Client = Depends(get_db)) -> UserService:
    """Dependency for UserService."""
    return UserService(db=db)


def get_auth_service(user_service: UserService = Depends(get_user_service)) -> AuthService:
    """Dependency for AuthService."""
    return AuthService(user_service=user_service)


def get_storage() -> gcloud_storage.Client:
    """Dependency for Google Cloud Storage client."""
    return get_storage_client()


def get_storage_service(storage_client: gcloud_storage.Client = Depends(get_storage)) -> StorageService:
    """Dependency for StorageService."""
    return StorageService(client=storage_client)


def get_meshy_service() -> MeshyService:
    """Dependency for MeshyService."""
    return MeshyService()


def get_project_service(
    db: gcloud_firestore.Client = Depends(get_db),
    storage_service: StorageService = Depends(get_storage_service),
    meshy_service: MeshyService = Depends(get_meshy_service),
) -> ProjectService:
    """Dependency for ProjectService."""
    return ProjectService(db=db, storage_service=storage_service, meshy_service=meshy_service)


def get_current_token_payload(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """Verify Firebase ID token in Authorization header."""
    token = credentials.credentials
    auth = get_auth()

    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except fb_auth.ExpiredIdTokenError:
        raise UnauthorizedException(
            detail="Authentication token has expired. Please refresh your session.",
            code="TOKEN_EXPIRED",
        )
    except fb_auth.RevokedIdTokenError:
        raise UnauthorizedException(
            detail="Authentication token has been revoked. Please log in again.",
            code="TOKEN_REVOKED",
        )
    except fb_auth.CertificateFetchError:
        logger.error("Failed to fetch Firebase public certs for token verification")
        raise UnauthorizedException(
            detail="Failed to verify token with auth server",
            code="AUTH_SERVER_ERROR",
        )
    except Exception as e:
        logger.warning("Token verification failed: %s", e)
        raise UnauthorizedException(
            detail="Invalid authentication token",
            code="INVALID_TOKEN",
        )


def get_current_user(
    token_payload: dict = Depends(get_current_token_payload),
    user_service: UserService = Depends(get_user_service),
) -> UserProfile:
    """Retrieve or self-heal user profile for authenticated requester."""
    uid = token_payload.get("uid")
    if not uid:
        raise UnauthorizedException(detail="Token contains no user identifier", code="INVALID_TOKEN")

    email = token_payload.get("email", "")
    display_name = token_payload.get("name")
    photo_url = token_payload.get("picture")
    email_verified = bool(token_payload.get("email_verified", False))

    user = user_service.get_or_create_user(
        uid=uid,
        email=email,
        display_name=display_name,
        photo_url=photo_url,
        email_verified=email_verified,
    )
    return user
