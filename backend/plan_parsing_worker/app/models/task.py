from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class ParsePlanTaskRequest(BaseModel):
    """Payload sent by Cloud Tasks or main API to trigger floor plan parsing."""

    jobId: str = Field(..., description="Unique job identifier")
    projectId: str = Field(..., description="Project document ID in Firestore")
    ownerUid: Optional[str] = Field(default=None, description="Project owner UID")
    gcsPath: Optional[str] = Field(default=None, description="Cloud Storage blob path")
    signedUrl: Optional[str] = Field(default=None, description="Accessible display/download URL for plan image")
    uploadId: Optional[str] = Field(default=None, description="Plan upload identifier")
    fileName: Optional[str] = Field(default=None, description="Original filename")
    contentType: Optional[str] = Field(default="image/png", description="MIME type")
    cropped: bool = Field(default=False, description="Image is the user's tight crop: skip corner detection")
    conversationId: Optional[str] = Field(default=None, description="Chat to notify with plan_ready / plan_failed")


class TaskStatusResponse(BaseModel):
    jobId: str
    status: str
    progress: int = 0
    stage: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
