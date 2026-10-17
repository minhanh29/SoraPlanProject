from typing import Any, Dict, List, Literal, Optional
from pydantic import Field

from .base import BaseSchema

Stage = Literal[
    "uploading",
    "cropping",
    "parsing",
    "reviewing_plan",
    "choosing_style",
    "resolving_missing",
    "scene_ready",
]

ActionType = Literal[
    "confirm_crop",
    "restart_crop",
    "retry_parse",
    "confirm_plan",
    "edit_plan",
    "select_style",
    "skip_missing",
    "continue",
    "undo_last_change",
]


class CropRect(BaseSchema):
    """Crop rectangle in pixels of the original upload."""

    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)


class CreateConversationRequest(BaseSchema):
    file_name: str = Field(..., min_length=1, max_length=255)
    content_type: str
    size_bytes: Optional[int] = Field(default=None, ge=1)


class CreateConversationResponse(BaseSchema):
    project_id: str
    conversation_id: str
    signed_upload_url: str
    content_type: str


class StageData(BaseSchema):
    crop: Optional[CropRect] = None


class UpdateConversationRequest(BaseSchema):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    stage_data: Optional[StageData] = None


class SendMessageRequest(BaseSchema):
    text: str = Field(..., min_length=1, max_length=4000)


class ActionRequest(BaseSchema):
    type: ActionType
    args: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(BaseSchema):
    ok: bool = True
    result: Optional[Any] = None


class ToolCallRecord(BaseSchema):
    name: str
    args: Dict[str, Any] = Field(default_factory=dict)
    result: Any = None


class MessageIdResponse(BaseSchema):
    message_id: str


class StageResponse(BaseSchema):
    stage: Stage


class ProjectFilesResponse(BaseSchema):
    plan_original_url: Optional[str] = None
    plan_url: Optional[str] = None


class SavePlanRequest(BaseSchema):
    floor_plan: Dict[str, Any]


class SavePlanResponse(BaseSchema):
    floor_plan_version: int


class Dims(BaseSchema):
    w: float = Field(..., gt=0.02, le=12)
    d: float = Field(..., gt=0.02, le=12)
    h: float = Field(..., gt=0.02, le=12)


class UpdateMappingRequest(BaseSchema):
    component_id: str
    dims: Optional[Dims] = None
    asset_id: Optional[str] = None
    apply_to_same_asset: bool = True
    reset: bool = False
    # Undo a Skip: the box needs a model again (mapping step only)
    restore: bool = False


class MappingResponse(BaseSchema):
    mapping: Dict[str, Any]


# ---------------------------------------------------------------- cinematic tour (AI director)

class TourRoom(BaseSchema):
    id: str = Field(..., max_length=80)
    name: str = Field(..., max_length=120)
    type: Optional[str] = Field(default=None, max_length=40)
    area: float = 0
    items: List[str] = Field(default_factory=list, max_length=60)
    connects_to: List[str] = Field(default_factory=list, max_length=20)


class TourCandidate(BaseSchema):
    id: str = Field(..., max_length=120)
    room_id: str = Field(..., max_length=80)
    description: str = Field(default="", max_length=800)
    score: float = 0
    # Preview frame, base64 JPEG (~384×216, a few tens of KB)
    image: Optional[str] = Field(default=None, max_length=250_000)


class TourPlanRequest(BaseSchema):
    title: str = Field(default="Home", max_length=120)
    style: Optional[str] = Field(default=None, max_length=40)
    rooms: List[TourRoom] = Field(..., max_length=20)
    candidates: List[TourCandidate] = Field(..., min_length=1, max_length=64)


class TourShotChoice(BaseSchema):
    candidate_id: str
    move: str
    duration: float
    reason: str = ""


class TourPlanResponse(BaseSchema):
    shots: List[TourShotChoice]
    source: str


class OpBatchRequest(BaseSchema):
    base_version: int = Field(..., ge=0)
    ops: List[Dict[str, Any]] = Field(..., min_length=1, max_length=200)
    origin: Literal["ui"] = "ui"
    label: Optional[str] = Field(default=None, max_length=120)


class OpResultResponse(BaseSchema):
    batch_id: str
    new_version: int
    applied: int
    warnings: List[Dict[str, Any]] = Field(default_factory=list)


class VersionResponse(BaseSchema):
    new_version: int
