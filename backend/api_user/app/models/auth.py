from typing import Optional
from pydantic import EmailStr, Field
from .base import BaseSchema
from .user import UserProfile


class SignUpRequest(BaseSchema):
    """Payload for registering a new user."""

    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128, description="Password with at least 6 characters")
    display_name: Optional[str] = Field(None, min_length=1, max_length=100)


class LoginRequest(BaseSchema):
    """Payload for email and password authentication."""

    email: EmailStr
    password: str = Field(..., min_length=1)


class GoogleAuthRequest(BaseSchema):
    """Payload for federated authentication via Firebase Google ID token."""

    id_token: str = Field(..., description="Firebase ID token issued after Google Sign-In on client")


class RefreshTokenRequest(BaseSchema):
    """Payload to refresh an expired Firebase ID token."""

    refresh_token: str = Field(..., description="Firebase refresh token")


class AuthResponse(BaseSchema):
    """Successful authentication response containing tokens and user profile."""

    id_token: str
    refresh_token: str
    expires_in: int = 3600
    user: UserProfile


class TokenRefreshResponse(BaseSchema):
    """Response returned when refreshing an ID token."""

    id_token: str
    refresh_token: str
    expires_in: int = 3600


class MessageResponse(BaseSchema):
    """Generic status response."""

    message: str
    success: bool = True
