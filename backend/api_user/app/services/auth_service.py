import logging
from typing import Optional
import httpx
from firebase_admin import auth as fb_auth
from firebase_admin.exceptions import FirebaseError

from ..config import Settings, get_settings
from ..errors import (
    AppException,
    ConflictException,
    InternalException,
    UnauthorizedException,
)
from ..firebase import get_auth
from ..models.auth import (
    AuthResponse,
    GoogleAuthRequest,
    LoginRequest,
    RefreshTokenRequest,
    SignUpRequest,
    TokenRefreshResponse,
)
from .user_service import UserService

logger = logging.getLogger("api_user.services.auth")


class AuthService:
    """Manages authentication with Firebase Auth and syncs with Firestore."""

    SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
    SECURE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token"

    def __init__(
        self,
        user_service: Optional[UserService] = None,
        settings: Optional[Settings] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ):
        self.user_service = user_service or UserService()
        self.settings = settings or get_settings()
        self._http_client = http_client

    async def get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=15.0)
        return self._http_client

    async def signup(self, req: SignUpRequest) -> AuthResponse:
        """Register a new user in Firebase Auth and initialize Firestore profile."""
        auth = get_auth()

        # Check for existing email in Firebase Auth
        try:
            auth.get_user_by_email(req.email)
            raise ConflictException(
                detail=f"An account with email '{req.email}' already exists",
                code="EMAIL_EXISTS",
            )
        except fb_auth.UserNotFoundError:
            # Expected: email is free to register
            pass
        except ConflictException:
            raise
        except Exception as e:
            logger.error("Failed to check existing user email: %s", e)

        # 1. Create Firebase Auth user
        try:
            user_record = auth.create_user(
                email=req.email,
                password=req.password,
                display_name=req.display_name,
                email_verified=False,
            )
            uid = user_record.uid
            logger.info("Successfully created Firebase Auth user uid: %s", uid)
        except fb_auth.EmailAlreadyExistsError:
            raise ConflictException(
                detail=f"An account with email '{req.email}' already exists",
                code="EMAIL_EXISTS",
            )
        except Exception as e:
            logger.error("Failed to create Firebase user: %s", e)
            raise AppException(detail=f"Failed to create user account: {str(e)}", code="REGISTRATION_FAILED")

        # 2. Initialize Firestore profile
        try:
            profile = self.user_service.create_user_profile(
                uid=uid,
                email=req.email,
                display_name=req.display_name,
                email_verified=False,
            )
        except Exception as e:
            logger.error("Failed to initialize user document in Firestore: %s", e)
            # Try to roll back auth user if Firestore creation fails
            try:
                auth.delete_user(uid)
            except Exception:
                pass
            raise InternalException(detail="Failed to initialize user account database record")

        # 3. Authenticate with credentials to obtain ID Token and Refresh Token
        auth_tokens = await self._sign_in_with_password(req.email, req.password)

        return AuthResponse(
            id_token=auth_tokens["idToken"],
            refresh_token=auth_tokens["refreshToken"],
            expires_in=int(auth_tokens.get("expiresIn", 3600)),
            user=profile,
        )

    async def login(self, req: LoginRequest) -> AuthResponse:
        """Authenticate user with email and password via Firebase Auth."""
        tokens = await self._sign_in_with_password(req.email, req.password)
        uid = tokens["localId"]

        # Ensure user profile exists in Firestore (self-healing if created externally)
        user_profile = self.user_service.get_or_create_user(
            uid=uid,
            email=req.email,
            display_name=tokens.get("displayName"),
            email_verified=bool(tokens.get("emailVerified", False)),
        )

        return AuthResponse(
            id_token=tokens["idToken"],
            refresh_token=tokens["refreshToken"],
            expires_in=int(tokens.get("expiresIn", 3600)),
            user=user_profile,
        )

    async def login_with_google(self, req: GoogleAuthRequest) -> AuthResponse:
        """Authenticate or sync a user who signed in with Google on the client."""
        auth = get_auth()
        try:
            decoded = auth.verify_id_token(req.id_token)
        except fb_auth.ExpiredIdTokenError:
            raise UnauthorizedException(detail="Google ID token has expired", code="TOKEN_EXPIRED")
        except Exception as e:
            logger.warning("Google ID token verification failed: %s", e)
            raise UnauthorizedException(detail="Invalid Google ID token", code="INVALID_TOKEN")

        uid = decoded["uid"]
        email = decoded.get("email", "")
        display_name = decoded.get("name")
        photo_url = decoded.get("picture")
        email_verified = bool(decoded.get("email_verified", False))

        profile = self.user_service.get_or_create_user(
            uid=uid,
            email=email,
            display_name=display_name,
            photo_url=photo_url,
            email_verified=email_verified,
        )

        return AuthResponse(
            id_token=req.id_token,
            refresh_token="",
            expires_in=3600,
            user=profile,
        )

    async def refresh_tokens(self, req: RefreshTokenRequest) -> TokenRefreshResponse:
        """Refresh Firebase ID token using refresh token."""
        client = await self.get_http_client()
        url = f"{self.SECURE_TOKEN_URL}?key={self.settings.FIREBASE_WEB_API_KEY}"
        data = {
            "grant_type": "refresh_token",
            "refresh_token": req.refresh_token,
        }

        try:
            response = await client.post(url, data=data)
            resp_data = response.json()
        except Exception as e:
            logger.error("Failed to connect to Firebase token refresh endpoint: %s", e)
            raise InternalException(detail="Token refresh service unavailable")

        if response.status_code != 200:
            error_msg = resp_data.get("error", {}).get("message", "INVALID_REFRESH_TOKEN")
            logger.warning("Token refresh failed: %s", error_msg)
            raise UnauthorizedException(
                detail="Invalid or expired refresh token. Please log in again.",
                code="INVALID_REFRESH_TOKEN",
            )

        return TokenRefreshResponse(
            id_token=resp_data["id_token"],
            refresh_token=resp_data["refresh_token"],
            expires_in=int(resp_data.get("expires_in", 3600)),
        )

    async def logout(self, uid: str) -> None:
        """Revoke all active refresh tokens for the given user."""
        auth = get_auth()
        try:
            auth.revoke_refresh_tokens(uid)
            logger.info("Revoked refresh tokens for user %s", uid)
        except Exception as e:
            logger.warning("Failed to revoke refresh tokens for user %s: %s", uid, e)

    async def _sign_in_with_password(self, email: str, password: str) -> dict:
        """Helper to invoke Firebase Identity Toolkit verifyPassword endpoint."""
        client = await self.get_http_client()
        url = f"{self.SIGN_IN_URL}?key={self.settings.FIREBASE_WEB_API_KEY}"
        payload = {
            "email": email,
            "password": password,
            "returnSecureToken": True,
        }

        try:
            response = await client.post(url, json=payload)
            data = response.json()
        except Exception as e:
            logger.error("Failed to reach Firebase Identity Toolkit: %s", e)
            raise InternalException(detail="Authentication provider service unreachable")

        if response.status_code != 200:
            err_code = data.get("error", {}).get("message", "INVALID_LOGIN_CREDENTIALS")
            logger.warning("Firebase login error for %s: %s", email, err_code)

            if "INVALID_LOGIN_CREDENTIALS" in err_code or "EMAIL_NOT_FOUND" in err_code or "INVALID_PASSWORD" in err_code:
                raise UnauthorizedException(
                    detail="Invalid email or password",
                    code="INVALID_CREDENTIALS",
                )
            elif "USER_DISABLED" in err_code:
                raise UnauthorizedException(
                    detail="This user account has been disabled",
                    code="USER_DISABLED",
                )
            elif "TOO_MANY_ATTEMPTS_TRY_LATER" in err_code:
                raise AppException(
                    status_code=429,
                    detail="Too many unsuccessful attempts. Access temporarily disabled.",
                    code="TOO_MANY_ATTEMPTS",
                )
            else:
                raise UnauthorizedException(
                    detail="Authentication failed. Please verify your credentials.",
                    code="AUTH_FAILED",
                )

        return data
