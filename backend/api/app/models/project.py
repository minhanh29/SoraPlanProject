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
    has_furniture: bool = Field(default=False, description="True if custom furniture photos have been uploaded")
    furniture_count: int = Field(default=0, description="Number of uploaded furniture photos for this project")
    created_at: Optional[datetime] = Field(default=None, description="Creation timestamp")
    updated_at: Optional[datetime] = Field(default=None, description="Last update timestamp")
