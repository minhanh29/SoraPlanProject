import logging

from fastapi import APIRouter, Depends, status

from ..deps import get_conversation_service, get_current_user, get_orchestrator, get_workflow
from ..models.conversation import (
    ActionRequest,
    ActionResponse,
    CreateConversationRequest,
    CreateConversationResponse,
    MessageIdResponse,
    SendMessageRequest,
    StageResponse,
    UpdateConversationRequest,
)
from ..models.user import UserProfile
from ..services.conversation_service import ConversationService
from ..services.orchestrator import Orchestrator
from ..services.workflow import Workflow

logger = logging.getLogger("api.routers.conversations")

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.post("", response_model=CreateConversationResponse, status_code=status.HTTP_201_CREATED,
             summary="Start a project from a floor plan file (returns a signed upload URL)")
def create_conversation(
    body: CreateConversationRequest,
    user: UserProfile = Depends(get_current_user),
    workflow: Workflow = Depends(get_workflow),
):
    return workflow.create(user.uid, body.file_name, body.content_type, body.size_bytes)


@router.post("/{conversation_id}/upload-complete", response_model=StageResponse,
             summary="The browser finished the upload: normalize the image and ask for a crop")
def upload_complete(
    conversation_id: str,
    user: UserProfile = Depends(get_current_user),
    workflow: Workflow = Depends(get_workflow),
):
    return {"stage": workflow.upload_complete(conversation_id, user.uid)}


@router.post("/{conversation_id}/messages", response_model=MessageIdResponse,
             summary="Send a chat message; the reply streams into Firestore while this request runs")
def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    user: UserProfile = Depends(get_current_user),
    orchestrator: Orchestrator = Depends(get_orchestrator),
):
    return {"messageId": orchestrator.handle_user_text(conversation_id, user.uid, body.text)}


@router.post("/{conversation_id}/stop", response_model=ActionResponse, summary="Stop the reply being generated")
def stop(
    conversation_id: str,
    user: UserProfile = Depends(get_current_user),
    conversations: ConversationService = Depends(get_conversation_service),
):
    conversations.get(conversation_id, user.uid)
    conversations._ref(conversation_id).update({"cancelRequested": True})
    return {"ok": True}


@router.post("/{conversation_id}/actions", response_model=ActionResponse,
             summary="UI buttons (confirm_crop, confirm_plan, select_style, …) — same handlers as Gemini tools")
def action(
    conversation_id: str,
    body: ActionRequest,
    user: UserProfile = Depends(get_current_user),
    orchestrator: Orchestrator = Depends(get_orchestrator),
):
    return {"ok": True, "result": orchestrator.handle_action(conversation_id, user.uid, body.type, body.args)}


@router.patch("/{conversation_id}", response_model=ActionResponse, summary="Rename, or save the crop rectangle")
def update_conversation(
    conversation_id: str,
    body: UpdateConversationRequest,
    user: UserProfile = Depends(get_current_user),
    workflow: Workflow = Depends(get_workflow),
):
    if body.title:
        workflow.rename(conversation_id, user.uid, body.title)
    if body.stage_data and body.stage_data.crop:
        workflow.set_crop(conversation_id, user.uid, body.stage_data.crop.model_dump())
    return {"ok": True}


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Delete the conversation, its project, scene and files")
def delete_conversation(
    conversation_id: str,
    user: UserProfile = Depends(get_current_user),
    workflow: Workflow = Depends(get_workflow),
):
    workflow.delete(conversation_id, user.uid)
    return None
