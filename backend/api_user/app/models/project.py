from datetime import datetime
from typing import Optional
from pydantic import Field
from .base import BaseSchema


class PlanImage(BaseSchema):
    """Metadata for uploaded floor plan sketch, PDF, or screenshot."""

    id: str = Field(..., description="Google Cloud auto-generated identifier")
    project_id: str = Field(..., description="Associated project identifier")
    owner_uid: str = Field(..., description="UID of project owner")
    file_name: str = Field(..., description="Original filename uploaded by user")
    content_type: str = Field(..., description="MIME type (e.g. image/png, application/pdf)")
    size_bytes: int = Field(default=0, description="File size in bytes")
    bucket: str = Field(..., description="Google Cloud Storage bucket name")
    storage_path: str = Field(..., description="Cloud Storage object path: {user_id}/{project_id}/{files}")
    gcs_uri: str = Field(..., description="Full gs:// path")
    signed_url: str = Field(..., description="V4 signed URL for public display/rendering")
    signed_url_expires_at: Optional[datetime] = Field(default=None, description="Expiration time of signed display URL")
    uploaded_at: Optional[datetime] = Field(default=None, description="Upload timestamp")


class Project(BaseSchema):
    """Full project representation stored in Firestore projects/{projectId} collection."""

    id: str = Field(..., description="Google Cloud auto-generated project identifier")
    owner_uid: str = Field(..., description="Owner Firebase UID")
    name: str = Field(..., description="User-assigned project name")
    description: Optional[str] = Field(default=None, description="Project description")
    status: str = Field(default="created", description="Project status: created | uploaded | processing | completed | failed")
    has_plan: bool = Field(default=False, description="True if a plan sketch/PDF/screenshot has already been uploaded")
    plan_image: Optional[PlanImage] = Field(default=None, description="Uploaded floor plan metadata and signed display URL")
    current_job_id: Optional[str] = Field(default=None, description="Current or latest plan parse job ID")
    has_plan_parsed: bool = Field(default=False, description="True if floor plan has been parsed into structured geometry")
    floor_plan: Optional[dict] = Field(default=None, description="Parsed structured 2D floor plan scene data")
    created_at: Optional[datetime] = Field(default=None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(default=None, description="Last update timestamp")


class CreateProjectRequest(BaseSchema):
    """Payload to create a new project."""

    name: str = Field(..., min_length=1, max_length=120, description="Project name")
    description: Optional[str] = Field(default=None, max_length=500, description="Optional project description")


class UpdateProjectRequest(BaseSchema):
    """Payload to update editable project fields."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)


class UploadUrlRequest(BaseSchema):
    """Payload to request a signed upload URL for direct-to-cloud upload."""

    file_name: str = Field(..., min_length=1, max_length=255, description="Filename including extension")
    content_type: str = Field(..., description="MIME type (image/png, image/jpeg, image/webp, application/pdf)")
    size_bytes: Optional[int] = Field(default=None, ge=1, description="File size in bytes")


class UploadUrlResponse(BaseSchema):
    """Response containing signed URLs for upload and public display."""

    upload_id: str = Field(..., description="Google Cloud generated content identifier")
    project_id: str = Field(..., description="Associated project identifier")
    bucket: str = Field(..., description="Target Cloud Storage bucket")
    storage_path: str = Field(..., description="Target object path in bucket")
    gcs_uri: str = Field(..., description="GCS URI")
    signed_upload_url: str = Field(..., description="V4 signed PUT URL for uploading file directly")
    signed_display_url: str = Field(..., description="V4 signed GET URL for public display")
    expires_in: int = Field(default=900, description="Signed upload URL validity in seconds")


class UploadConfirmRequest(BaseSchema):
    """Payload to confirm completion of direct-to-cloud upload."""

    upload_id: str = Field(..., description="Google Cloud generated content identifier")
    file_name: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(...)
    size_bytes: Optional[int] = Field(default=None, ge=1)
