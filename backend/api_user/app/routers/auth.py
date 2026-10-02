from fastapi import APIRouter, Depends, status

from ..deps import get_auth_service, get_current_token_payload, get_current_user
from ..models.auth import (
    AuthResponse,
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    RefreshTokenRequest,
    SignUpRequest,
    TokenRefreshResponse,
)
from ..models.user import UserProfile
from ..services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    description="Registers a user with Firebase Auth, initializes Firestore profile with default quotas, and returns session tokens.",
)
async def signup(
    payload: SignUpRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> AuthResponse:
    return await auth_service.signup(payload)


@router.post(
    "/login",
    response_model=AuthResponse,
    status_code=status.HTTP_200_OK,
    summary="Log in with email and password",
    description="Authenticates against Firebase Auth, retrieves or heals the Firestore profile, and returns ID and refresh tokens.",
)
async def login(
    payload: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> AuthResponse:
    return await auth_service.login(payload)


@router.post(
    "/google",
    response_model=AuthResponse,
    status_code=status.HTTP_200_OK,
    summary="Authenticate via Google",
    description="Verifies a Firebase ID token from Google Sign-In and returns or initializes the user profile in Firestore.",
)
async def google_auth(
    payload: GoogleAuthRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> AuthResponse:
    return await auth_service.login_with_google(payload)


@router.post(
    "/refresh",
    response_model=TokenRefreshResponse,
    status_code=status.HTTP_200_OK,
    summary="Refresh access token",
    description="Exchange a valid Firebase refresh token for a newly minted ID token.",
)
async def refresh_token(
    payload: RefreshTokenRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> TokenRefreshResponse:
    return await auth_service.refresh_tokens(payload)


@router.get(
    "/me",
    response_model=UserProfile,
    status_code=status.HTTP_200_OK,
    summary="Get current user profile",
    description="Returns the Firestore profile and quota details for the authenticated user.",
)
async def get_me(
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    return current_user


@router.post(
    "/logout",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    summary="Log out",
    description="Revokes all refresh tokens issued to the currently authenticated user.",
)
async def logout(
    token_payload: dict = Depends(get_current_token_payload),
    auth_service: AuthService = Depends(get_auth_service),
) -> MessageResponse:
    uid = token_payload.get("uid")
    if uid:
        await auth_service.logout(uid)
    return MessageResponse(message="Successfully logged out")
