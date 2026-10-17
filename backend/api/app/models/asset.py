from typing import Optional
from pydantic import Field

from .base import BaseSchema


class AssetUploadUrlRequest(BaseSchema):
    file_name: str = Field(..., min_length=1, max_length=255)
    content_type: str
    size_bytes: Optional[int] = Field(default=None, ge=1)


class AssetUploadUrlResponse(BaseSchema):
    asset_id: str
    signed_upload_url: str
    content_type: str


class ConfirmAssetRequest(BaseSchema):
    name: str = Field(..., min_length=1, max_length=120)
    category: str = Field(..., min_length=1, max_length=60)
    style: Optional[str] = None
    project_id: Optional[str] = None
    component_id: Optional[str] = None


class UpdateAssetRequest(BaseSchema):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    category: Optional[str] = Field(default=None, min_length=1, max_length=60)
    style: Optional[str] = None
    is_system: Optional[bool] = None


class BackgroundRemovalResponse(BaseSchema):
    data_uri: str


class PollRequest(BaseSchema):
    attempt: int = Field(default=0, ge=0)
