"""Endpoints called by Cloud Tasks only (OIDC-verified), not by browsers."""
import logging

from fastapi import APIRouter, Depends, Request

from ..config import get_settings
from ..deps import get_asset_service
from ..errors import ForbiddenException, UnauthorizedException
from ..models.asset import PollRequest
from ..services.asset_service import AssetService

logger = logging.getLogger("api.routers.internal")

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


def verify_tasks_oidc(request: Request) -> None:
    """Accept only Google-signed ID tokens for TASKS_INVOKER_SA with audience API_PUBLIC_URL."""
    settings = get_settings()
    if not settings.TASKS_INVOKER_SA or not settings.API_PUBLIC_URL:
        if settings.ENV in ("development", "testing"):
            return
        raise ForbiddenException(detail="Internal endpoints are not configured", code="INTERNAL_DISABLED")
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise UnauthorizedException(detail="Missing OIDC token", code="MISSING_TOKEN")
    import google.auth.transport.requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(
            header[7:], google.auth.transport.requests.Request(), audience=settings.API_PUBLIC_URL.rstrip("/")
        )
    except Exception as e:
        logger.warning("Rejected internal call: %s", e)
        raise UnauthorizedException(detail="Invalid OIDC token", code="INVALID_TOKEN")
    if claims.get("email") != settings.TASKS_INVOKER_SA or not claims.get("email_verified", True):
        raise ForbiddenException(detail="Caller is not the tasks invoker", code="WRONG_CALLER")


@router.post("/assets/{asset_id}/poll")
def poll_asset(
    asset_id: str,
    body: PollRequest,
    _: None = Depends(verify_tasks_oidc),
    assets: AssetService = Depends(get_asset_service),
):
    running = assets.poll(asset_id, body.attempt)
    return {"running": running}
