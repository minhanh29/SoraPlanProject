import logging
from typing import List, Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status

from ..deps import get_asset_service, get_current_user, get_project_service
from ..errors import AppException
from ..models.asset import (
    AssetUploadUrlRequest,
    AssetUploadUrlResponse,
    BackgroundRemovalResponse,
    ConfirmAssetRequest,
    UpdateAssetRequest,
)
from ..models.user import UserProfile
from ..services.asset_service import AssetService
from ..services.project_service import ProjectService

logger = logging.getLogger("api.routers.assets")

router = APIRouter(prefix="/assets", tags=["assets"])


def _public(a: dict) -> dict:
    """Asset as the web app sees it (drops internal fields)."""
    hidden = {"links", "meshyTaskId", "urlsExpireAt"}
    out = {k: v for k, v in a.items() if k not in hidden}
    for k in ("createdAt", "updatedAt"):
        if hasattr(out.get(k), "isoformat"):
            out[k] = out[k].isoformat()
        elif out.get(k) is not None and not isinstance(out.get(k), str):
            out[k] = None
    return out


@router.get("", summary="List the system catalog or your own assets (re-signs expiring URLs)")
def list_assets(
    scope: Literal["system", "mine"] = Query("mine"),
    user: UserProfile = Depends(get_current_user),
    assets: AssetService = Depends(get_asset_service),
) -> List[dict]:
    return [_public(a) for a in assets.list(scope, user.uid)]


@router.post("/upload-url", response_model=AssetUploadUrlResponse, summary="Signed URL to upload a furniture photo")
def upload_url(
    body: AssetUploadUrlRequest,
    user: UserProfile = Depends(get_current_user),
    assets: AssetService = Depends(get_asset_service),
):
    return assets.create_upload_url(user.uid, body.file_name, body.content_type, body.size_bytes)


@router.post("/{asset_id}/confirm", status_code=status.HTTP_201_CREATED,
             summary="Register the uploaded photo and start image-to-3D (optionally filling a plan box)")
def confirm(
    asset_id: str,
    body: ConfirmAssetRequest,
    user: UserProfile = Depends(get_current_user),
    assets: AssetService = Depends(get_asset_service),
) -> dict:
    return _public(assets.confirm(user.uid, asset_id, body.name, body.category, body.style, body.project_id, body.component_id))


@router.patch("/{asset_id}", summary="Rename / recategorize; admins can promote to system (style + category required)")
def update_asset(
    asset_id: str,
    body: UpdateAssetRequest,
    user: UserProfile = Depends(get_current_user),
    assets: AssetService = Depends(get_asset_service),
) -> dict:
    return _public(assets.update(user, asset_id, body.model_dump(exclude_unset=True)))


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an asset and its files")
def delete_asset(asset_id: str, user: UserProfile = Depends(get_current_user), assets: AssetService = Depends(get_asset_service)):
    assets.delete(user, asset_id)
    return None


@router.post("/remove-background", response_model=BackgroundRemovalResponse,
             summary="Cut the furniture out of its photo (via the private worker)")
def remove_background(
    file: UploadFile = File(...),
    name: str = Form(default="furniture"),
    user: UserProfile = Depends(get_current_user),
    assets: AssetService = Depends(get_asset_service),
    projects: ProjectService = Depends(get_project_service),
):
    ctype = file.content_type or "image/jpeg"
    data = file.file.read()
    if not data:
        raise AppException(status_code=400, code="EMPTY_FILE", detail="The photo is empty")
    if ctype == "application/octet-stream":
        ctype = "image/jpeg"
    try:
        uri = assets.remove_background(
            data, file.filename or "photo.jpg", ctype, name,
            lambda b, fn, ct, nm: projects.remove_furniture_background(b, fn, ct, nm),
        )
    except AppException:
        raise
    except Exception as e:
        logger.error("Background removal failed: %s", e)
        raise AppException(status_code=502, code="BACKGROUND_REMOVAL_FAILED", detail="Could not remove the background")
    return {"dataUri": uri}
