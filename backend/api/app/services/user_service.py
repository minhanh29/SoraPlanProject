import logging
from datetime import datetime, timezone
from typing import Optional
from google.cloud import firestore as gcloud_firestore

from ..config import get_settings
from ..errors import NotFoundException
from ..firebase import get_auth, get_firestore_client
from ..models.user import UpdateUserRequest, UserProfile, UserQuota, UserQuotaResponse

logger = logging.getLogger("api.services.user")


class UserService:
    """Manages user profiles and quota records in Firestore."""

    COLLECTION_NAME = "users"
    def __init__(self, db: Optional[gcloud_firestore.Client] = None):
        self._db = db

    @property
    def ADMIN_UIDS(self) -> set:
        return set(get_settings().ADMIN_UIDS)

    @property
    def db(self) -> gcloud_firestore.Client:
        if self._db is None:
            self._db = get_firestore_client()
        return self._db

    def get_user_by_id(self, uid: str) -> Optional[UserProfile]:
        """Fetch user document from Firestore by UID with RBAC role resolution."""
        doc_ref = self.db.collection(self.COLLECTION_NAME).document(uid)
        doc = doc_ref.get()
        if not doc.exists:
            return None

        data = doc.to_dict() or {}
        # Ensure role is set in Firestore and matches RBAC assignments
        expected_role = "admin" if uid in self.ADMIN_UIDS else data.get("role", "user")
        if data.get("role") != expected_role:
            try:
                doc_ref.update({"role": expected_role, "updatedAt": datetime.now(timezone.utc)})
            except Exception as e:
                logger.warning("Could not sync role to Firestore for %s: %s", uid, e)
            data["role"] = expected_role

        return self._dict_to_profile(uid, data)

    def get_user_or_raise(self, uid: str) -> UserProfile:
        """Fetch user profile or raise 404 NotFoundException."""
        user = self.get_user_by_id(uid)
        if not user:
            raise NotFoundException(detail=f"User {uid} not found", code="USER_NOT_FOUND")
        return user

    def create_user_profile(
        self,
        uid: str,
        email: str,
        display_name: Optional[str] = None,
        photo_url: Optional[str] = None,
        email_verified: bool = False,
    ) -> UserProfile:
        """Create new user profile in Firestore with initial quotas."""
        now = datetime.now(timezone.utc)
        default_quota = UserQuota(
            projects=5,
            renders_final=20,
            renders_draft=100,
            assets3d=10,
            plan_parses=20,
            reset_at=None,
        )

        role = "admin" if uid in self.ADMIN_UIDS else "user"
        user_data = {
            "uid": uid,
            "email": email,
            "displayName": display_name or "",
            "photoUrl": photo_url,
            "role": role,
            "plan": "free",
            "quota": default_quota.model_dump(by_alias=True),
            "emailVerified": email_verified,
            "createdAt": now,
            "updatedAt": now,
        }

        doc_ref = self.db.collection(self.COLLECTION_NAME).document(uid)
        doc_ref.set(user_data)
        logger.info("Created Firestore user document for uid: %s", uid)

        return self._dict_to_profile(uid, user_data)

    def get_or_create_user(
        self,
        uid: str,
        email: str,
        display_name: Optional[str] = None,
        photo_url: Optional[str] = None,
        email_verified: bool = False,
    ) -> UserProfile:
        """Get existing user profile or initialize if missing."""
        existing = self.get_user_by_id(uid)
        if existing:
            return existing

        return self.create_user_profile(
            uid=uid,
            email=email,
            display_name=display_name,
            photo_url=photo_url,
            email_verified=email_verified,
        )

    def update_user_profile(self, uid: str, update: UpdateUserRequest) -> UserProfile:
        """Update mutable user profile fields in Firestore and Firebase Auth."""
        doc_ref = self.db.collection(self.COLLECTION_NAME).document(uid)
        doc = doc_ref.get()
        if not doc.exists:
            raise NotFoundException(detail="User profile not found", code="USER_NOT_FOUND")

        now = datetime.now(timezone.utc)
        updates = {"updatedAt": now}
        auth_updates = {}

        if update.display_name is not None:
            updates["displayName"] = update.display_name
            auth_updates["display_name"] = update.display_name

        if update.photo_url is not None:
            updates["photoUrl"] = update.photo_url
            auth_updates["photo_url"] = update.photo_url

        doc_ref.update(updates)

        # Sync displayName and photoUrl to Firebase Auth
        if auth_updates:
            try:
                auth = get_auth()
                auth.update_user(uid, **auth_updates)
            except Exception as e:
                logger.warning("Failed to sync profile update to Firebase Auth for %s: %s", uid, e)

        merged = doc.to_dict() or {}
        merged.update(updates)
        return self._dict_to_profile(uid, merged)

    def get_quota(self, uid: str) -> UserQuotaResponse:
        """Retrieve user's quota configuration."""
        user = self.get_user_or_raise(uid)
        return UserQuotaResponse(
            uid=user.uid,
            plan=user.plan,
            quota=user.quota,
        )

    def _dict_to_profile(self, uid: str, data: dict) -> UserProfile:
        quota_data = data.get("quota") or {}
        quota = UserQuota(
            projects=quota_data.get("projects", 5),
            renders_final=quota_data.get("rendersFinal", 20),
            renders_draft=quota_data.get("rendersDraft", 100),
            assets3d=quota_data.get("assets3d", 10),
            plan_parses=quota_data.get("planParses", 20),
            reset_at=quota_data.get("resetAt"),
        )

        role = "admin" if uid in self.ADMIN_UIDS else data.get("role", "user")

        return UserProfile(
            uid=uid,
            email=data.get("email", ""),
            display_name=data.get("displayName") or None,
            photo_url=data.get("photoUrl") or None,
            role=role,
            plan=data.get("plan", "free"),
            quota=quota,
            email_verified=bool(data.get("emailVerified", False)),
            created_at=data.get("createdAt"),
            updated_at=data.get("updatedAt"),
        )
