from datetime import datetime, timezone
from typing import Optional
from pydantic import Field
from .base import BaseSchema


class UserQuota(BaseSchema):
    """User operational quotas as defined in docs/05-backend.md."""

    projects: int = Field(default=5, description="Maximum number of active projects")
    renders_final: int = Field(default=20, description="Final photoreal renders per day")
    renders_draft: int = Field(default=100, description="Draft renders per day")
    assets3d: int = Field(default=10, description="Image-to-3D generations per month")
    plan_parses: int = Field(default=20, description="Plan parses per day")
    reset_at: Optional[datetime] = Field(default=None, description="Next quota reset timestamp")


class UserProfile(BaseSchema):
    """Full user profile stored in Firestore users/{uid} collection."""

    uid: str
    email: str
    display_name: Optional[str] = None
    photo_url: Optional[str] = None
    role: str = Field(default="user", description="User role ('user' or 'admin')")
    plan: str = Field(default="free", description="User subscription tier (free, pro, enterprise)")
    quota: UserQuota = Field(default_factory=UserQuota)
    email_verified: bool = False
    samples: Optional[str] = Field(default=None, description="Sample projects: pending | copying | done (None: never)")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class UpdateUserRequest(BaseSchema):
    """Payload to update editable user profile fields."""

    display_name: Optional[str] = Field(None, min_length=1, max_length=100)
    photo_url: Optional[str] = None


class UserQuotaResponse(BaseSchema):
    """Quota response for inspection."""

    plan: str
    quota: UserQuota
    uid: str
