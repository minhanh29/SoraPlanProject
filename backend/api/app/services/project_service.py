import base64
import datetime
import logging
import mimetypes
import os
import requests
import uuid
from typing import Any, Dict, List, Optional
from firebase_admin import firestore
from google.cloud import firestore as gcloud_firestore
from google.cloud.firestore import FieldFilter

from ..config import get_settings
from ..errors import (
    AppException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
    QuotaExceededException,
)
from ..models.project import (
    ChooseAssetRequest,
    FurnitureImage,
    PlanImage,
    Project,
    UpdateFurnitureRequest,
    UpdateFurnitureSystemRequest,
    UploadUrlResponse,
)
from ..models.user import UserProfile
from .storage_service import StorageService
from .meshy_service import MeshyService

logger = logging.getLogger("api.project_service")


class ProjectService:
    """Service handling project management and single-plan upload lifecycle."""

    def __init__(
        self,
        db: gcloud_firestore.Client,
        storage_service: Optional[StorageService] = None,
        meshy_service: Optional[MeshyService] = None,
    ):
        self.db = db
        self.storage_service = storage_service or StorageService()
        self.meshy_service = meshy_service or MeshyService()
        self.settings = get_settings()

    def catalog_url(self, logical_path: str) -> str:
        """Public URL of a preset catalog object; logical paths look like assets/{Style}/{file}."""
        if not logical_path or logical_path.startswith(("http://", "https://")):
            return logical_path
        return f"{self.settings.catalog_base_url}/{logical_path.lstrip('/')}"

    @staticmethod
    def _is_system_item(item: dict) -> bool:
        return bool(
            item.get("is_system")
            or item.get("isSystem")
            or str(item.get("gcsUri") or "").startswith("system://")
            or str(item.get("storagePath") or "").startswith("assets/")
        )

    @staticmethod
    def build_storage_path(user_uid: str, project_id: str, file_id: str, ext: str) -> str:
        """Build storage object path following structure: {user_id}/{project_id}/{files}."""
        return f"{user_uid}/{project_id}/{file_id}{ext}"

    @staticmethod
    def build_furniture_storage_path(user_uid: str, project_id: str, file_id: str, ext: str) -> str:
        """Build storage object path for furniture uploads: {user_id}/{project_id}/furniture/{file_id}{ext}."""
        return f"{user_uid}/{project_id}/furniture/{file_id}{ext}"

    def create_project(
        self,
        user_uid: str,
        name: str,
        description: Optional[str] = None,
    ) -> Project:
        """Create a new project for user with Google Cloud auto-generated identifier."""
        # 1. Enforce user quota on active projects
        self._check_project_quota(user_uid)

        # 2. Generate project ID following Google Cloud Firestore ID rules (never created locally)
        project_ref = self.db.collection("projects").document()
        project_id = project_ref.id

        now = datetime.datetime.now(datetime.timezone.utc)
        project_data = {
            "id": project_id,
            "ownerUid": user_uid,
            "name": name.strip(),
            "description": description.strip() if description else None,
            "status": "created",
            "hasPlan": False,
            "planImage": None,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }

        project_ref.set(project_data)
        logger.info("Created new project %s for user %s", project_id, user_uid)

        return Project(
            id=project_id,
            owner_uid=user_uid,
            name=name.strip(),
            description=description.strip() if description else None,
            status="created",
            has_plan=False,
            plan_image=None,
            created_at=now,
            updated_at=now,
        )

    def get_project(self, project_id: str, user_uid: str) -> Project:
        """Retrieve project by ID and verify ownership, refreshing signed display URL if needed."""
        doc_ref = self.db.collection("projects").document(project_id)
        doc = doc_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        data = doc.to_dict() or {}
        if data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to access this project",
                code="PROJECT_ACCESS_DENIED",
            )

        # Refresh signed URL for the plan image if one exists
        if data.get("hasPlan") and data.get("planImage"):
            data["planImage"] = self._refresh_plan_signed_url(data["planImage"])

        return self._dict_to_project(data)

    def list_projects(self, user_uid: str) -> List[Project]:
        """List all projects owned by user with fresh signed display URLs."""
        try:
            docs = (
                self.db.collection("projects")
                .where(filter=FieldFilter("ownerUid", "==", user_uid))
                .stream()
            )
        except (TypeError, Exception):
            docs = (
                self.db.collection("projects")
                .where("ownerUid", "==", user_uid)
                .stream()
            )

        projects: List[Project] = []
        for doc in docs:
            data = doc.to_dict() or {}
            if data.get("hasPlan") and data.get("planImage"):
                data["planImage"] = self._refresh_plan_signed_url(data["planImage"])
            projects.append(self._dict_to_project(data))

        # Sort projects by created_at descending (latest first)
        projects.sort(
            key=lambda p: p.created_at or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc),
            reverse=True,
        )
        return projects

    def upload_plan_file(
        self,
        project_id: str,
        user_uid: str,
        file_name: str,
        content_type: str,
        file_bytes: bytes,
    ) -> Project:
        """Upload sketch, PDF, or screenshot directly to Cloud Storage and update Firestore.
        
        Rules:
        - Project must exist and belong to user.
        - One project uses only one sketch, PDF, or screenshot. If already uploaded, reject.
        - Google Cloud auto-generated ID is used for storage path and Firestore document.
        - Storage path follows: soraplan-assest-dev -> user_id -> project_id -> files
        - V4 Signed URL is created for public display.
        - Firestore is updated with the new state.
        """
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        # Enforce single-upload constraint
        if project_data.get("hasPlan") or project_data.get("planImage") is not None:
            raise ConflictException(
                detail=(
                    "A floor plan has already been uploaded for this project. "
                    "Each project allows only one sketch, PDF, or screenshot. "
                    "To upload another one, please create a new project."
                ),
                code="PLAN_ALREADY_UPLOADED",
            )

        # Validate file type
        self._validate_content_type(content_type, file_name)

        # Validate file size
        file_size = len(file_bytes)
        if file_size <= 0:
            raise AppException(
                status_code=400,
                code="EMPTY_FILE",
                detail="Uploaded file is empty",
            )
        if file_size > self.settings.MAX_UPLOAD_SIZE_BYTES:
            max_mb = self.settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
            raise AppException(
                status_code=400,
                code="FILE_TOO_LARGE",
                detail=f"File exceeds maximum allowed size of {max_mb}MB",
            )

        # Generate Google Cloud auto-ID from Firestore subcollection (never created locally)
        plan_image_ref = project_ref.collection("planImages").document()
        content_id = plan_image_ref.id

        # Determine file extension
        ext = self._get_extension(file_name, content_type)
        # Follow path rule: soraplan-assest-dev -> user_id -> project_id -> files
        blob_path = self.build_storage_path(user_uid, project_id, content_id, ext)

        # 1. Upload bytes to Google Cloud Storage
        upload_result = self.storage_service.upload_bytes(
            data=file_bytes,
            blob_path=blob_path,
            content_type=content_type,
        )

        # 2. Generate signed display URL for public viewing
        signed_display_url = self.storage_service.generate_signed_read_url(
            blob_path=blob_path,
            expiration_seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS,
        )
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS
        )

        # 3. Write on Firestore about the new update
        now = datetime.datetime.now(datetime.timezone.utc)
        plan_image_dict = {
            "id": content_id,
            "projectId": project_id,
            "ownerUid": user_uid,
            "fileName": file_name,
            "contentType": content_type,
            "sizeBytes": file_size,
            "bucket": self.storage_service.bucket_name,
            "storagePath": blob_path,
            "gcsUri": upload_result["gcsUri"],
            "signedUrl": signed_display_url,
            "signedUrlExpiresAt": expires_at.isoformat(),
            "uploadedAt": now.isoformat(),
        }

        # Write subcollection document
        plan_image_ref.set({
            **plan_image_dict,
            "uploadedAt": firestore.SERVER_TIMESTAMP,
        })

        # Update root project document
        project_ref.update({
            "hasPlan": True,
            "status": "uploaded",
            "planImage": plan_image_dict,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        logger.info(
            "Plan uploaded successfully for project %s (contentId: %s, path: %s)",
            project_id,
            content_id,
            blob_path,
        )

        project_data.update({
            "hasPlan": True,
            "status": "uploaded",
            "planImage": plan_image_dict,
            "updatedAt": now,
        })
        return self._dict_to_project(project_data)

    def create_upload_url(
        self,
        project_id: str,
        user_uid: str,
        file_name: str,
        content_type: str,
        size_bytes: Optional[int] = None,
    ) -> UploadUrlResponse:
        """Generate signed upload and display URLs for direct client-to-storage uploads."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        if project_data.get("hasPlan") or project_data.get("planImage") is not None:
            raise ConflictException(
                detail=(
                    "A floor plan has already been uploaded for this project. "
                    "Each project allows only one sketch, PDF, or screenshot. "
                    "To upload another one, please create a new project."
                ),
                code="PLAN_ALREADY_UPLOADED",
            )

        self._validate_content_type(content_type, file_name)

        if size_bytes and size_bytes > self.settings.MAX_UPLOAD_SIZE_BYTES:
            max_mb = self.settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
            raise AppException(
                status_code=400,
                code="FILE_TOO_LARGE",
                detail=f"File exceeds maximum allowed size of {max_mb}MB",
            )

        # Google Cloud auto-generated identifier via Firestore subcollection
        plan_image_ref = project_ref.collection("planImages").document()
        content_id = plan_image_ref.id

        ext = self._get_extension(file_name, content_type)
        # Follow path rule: soraplan-assest-dev -> user_id -> project_id -> files
        blob_path = self.build_storage_path(user_uid, project_id, content_id, ext)

        signed_upload_url = self.storage_service.generate_signed_upload_url(
            blob_path=blob_path,
            content_type=content_type,
            expiration_seconds=900,
        )
        signed_display_url = self.storage_service.generate_signed_read_url(
            blob_path=blob_path,
            expiration_seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS,
        )

        return UploadUrlResponse(
            upload_id=content_id,
            project_id=project_id,
            bucket=self.storage_service.bucket_name,
            storage_path=blob_path,
            gcs_uri=f"gs://{self.storage_service.bucket_name}/{blob_path}",
            signed_upload_url=signed_upload_url,
            signed_display_url=signed_display_url,
            expires_in=900,
        )

    def confirm_upload(
        self,
        project_id: str,
        user_uid: str,
        upload_id: str,
        file_name: str,
        content_type: str,
        size_bytes: Optional[int] = None,
    ) -> Project:
        """Confirm completion of direct-to-cloud upload and write to Firestore."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        if project_data.get("hasPlan") or project_data.get("planImage") is not None:
            raise ConflictException(
                detail=(
                    "A floor plan has already been uploaded for this project. "
                    "Each project allows only one sketch, PDF, or screenshot. "
                    "To upload another one, please create a new project."
                ),
                code="PLAN_ALREADY_UPLOADED",
            )

        ext = self._get_extension(file_name, content_type)
        # Follow path rule: soraplan-assest-dev -> user_id -> project_id -> files
        blob_path = self.build_storage_path(user_uid, project_id, upload_id, ext)

        signed_display_url = self.storage_service.generate_signed_read_url(
            blob_path=blob_path,
            expiration_seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS,
        )
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS
        )

        now = datetime.datetime.now(datetime.timezone.utc)
        plan_image_dict = {
            "id": upload_id,
            "projectId": project_id,
            "ownerUid": user_uid,
            "fileName": file_name,
            "contentType": content_type,
            "sizeBytes": size_bytes or 0,
            "bucket": self.storage_service.bucket_name,
            "storagePath": blob_path,
            "gcsUri": f"gs://{self.storage_service.bucket_name}/{blob_path}",
            "signedUrl": signed_display_url,
            "signedUrlExpiresAt": expires_at.isoformat(),
            "uploadedAt": now.isoformat(),
        }

        # Write to subcollection planImages/{upload_id}
        project_ref.collection("planImages").document(upload_id).set({
            **plan_image_dict,
            "uploadedAt": firestore.SERVER_TIMESTAMP,
        })

        # Update root project document
        project_ref.update({
            "hasPlan": True,
            "status": "uploaded",
            "planImage": plan_image_dict,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        project_data.update({
            "hasPlan": True,
            "status": "uploaded",
            "planImage": plan_image_dict,
            "updatedAt": now,
        })
        return self._dict_to_project(project_data)

    def _validate_furniture_content_type(self, content_type: str, file_name: str):
        """Ensure file is an accepted furniture photo format (PNG, JPEG, WebP)."""
        normalized_type = (content_type or "").lower().strip()
        if not normalized_type or normalized_type == "application/octet-stream":
            guessed, _ = mimetypes.guess_type(file_name)
            if guessed:
                normalized_type = guessed.lower()

        allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
        if normalized_type not in allowed:
            raise AppException(
                status_code=400,
                code="UNSUPPORTED_FILE_TYPE",
                detail=(
                    f"Unsupported furniture photo format '{content_type}'. "
                    "Please upload a photo of your furniture (PNG, JPEG, or WebP)."
                ),
            )

    def create_furniture_upload_url(
        self,
        project_id: str,
        user_uid: str,
        file_name: str,
        content_type: str,
        size_bytes: Optional[int] = None,
        furniture_name: Optional[str] = None,
        furniture_type: Optional[str] = None,
        component_id: Optional[str] = None,
    ) -> UploadUrlResponse:
        """Generate signed upload and display URLs for direct furniture photo uploads."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        self._validate_furniture_content_type(content_type, file_name)

        if size_bytes and size_bytes > self.settings.MAX_UPLOAD_SIZE_BYTES:
            max_mb = self.settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
            raise AppException(
                status_code=400,
                code="FILE_TOO_LARGE",
                detail=f"File exceeds maximum allowed size of {max_mb}MB",
            )

        furn_ref = project_ref.collection("furnitureImages").document()
        content_id = furn_ref.id

        ext = self._get_extension(file_name, content_type)
        blob_path = self.build_furniture_storage_path(user_uid, project_id, content_id, ext)

        signed_upload_url = self.storage_service.generate_signed_upload_url(
            blob_path=blob_path,
            content_type=content_type,
            expiration_seconds=900,
        )
        signed_display_url = self.storage_service.generate_signed_read_url(
            blob_path=blob_path,
            expiration_seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS,
        )

        return UploadUrlResponse(
            upload_id=content_id,
            project_id=project_id,
            bucket=self.storage_service.bucket_name,
            storage_path=blob_path,
            gcs_uri=f"gs://{self.storage_service.bucket_name}/{blob_path}",
            signed_upload_url=signed_upload_url,
            signed_display_url=signed_display_url,
            expires_in=900,
        )

    def confirm_furniture_upload(
        self,
        project_id: str,
        user_uid: str,
        upload_id: str,
        file_name: str,
        content_type: str,
        size_bytes: Optional[int] = None,
        furniture_name: Optional[str] = None,
        furniture_type: Optional[str] = None,
        component_id: Optional[str] = None,
        is_system: bool = False,
        current_user: Optional[UserProfile] = None,
    ) -> FurnitureImage:
        """Confirm direct furniture photo upload to Storage and register in Firestore."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        ext = self._get_extension(file_name, content_type)
        blob_path = self.build_furniture_storage_path(user_uid, project_id, upload_id, ext)

        now = datetime.datetime.now(datetime.timezone.utc)
        expires_at = now + datetime.timedelta(seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS)
        signed_display_url = self.storage_service.generate_signed_read_url(
            blob_path=blob_path,
            expiration_seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS,
        )

        derived_name = (
            furniture_name.strip()
            if furniture_name and furniture_name.strip()
            else file_name.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").title()
        )

        furniture_dict = {
            "id": upload_id,
            "projectId": project_id,
            "ownerUid": user_uid,
            "fileName": file_name,
            "furnitureName": derived_name,
            "furnitureType": (furniture_type or "unknown").strip().lower(),
            "componentId": component_id,
            "contentType": content_type,
            "sizeBytes": size_bytes or 0,
            "bucket": self.storage_service.bucket_name,
            "storagePath": blob_path,
            "gcsUri": f"gs://{self.storage_service.bucket_name}/{blob_path}",
            "signedUrl": signed_display_url,
            "signedUrlExpiresAt": expires_at.isoformat(),
            "status": "uploaded",
            "uploadedAt": now.isoformat(),
        }

        # Trigger Meshy 3D generation if configured
        meshy_task_id = None
        meshy_status = None
        current_status = "uploaded"
        try:
            if self.meshy_service.is_configured:
                # Prepare image URL for Meshy: convert uploaded image blob to data URI so Meshy gets exact image
                image_target_url = None
                try:
                    blob = self.storage_service.bucket.blob(blob_path)
                    blob_bytes = blob.download_as_bytes()
                    if blob_bytes and len(blob_bytes) <= 25 * 1024 * 1024:
                        mime = content_type or "image/jpeg"
                        b64_data = base64.b64encode(blob_bytes).decode("utf-8")
                        image_target_url = f"data:{mime};base64,{b64_data}"
                except Exception as ex:
                    logger.warning("Could not convert uploaded furniture to data URI: %s", ex)

                if not image_target_url:
                    image_target_url = signed_display_url

                meshy_task_id = self.meshy_service.create_image_to_3d_task(
                    image_url=image_target_url,
                    resolution="standard",
                    texture_allowed=True,
                    enhancement_allowed=True,
                )
                meshy_status = "PENDING"
                current_status = "generating_3d"
        except Exception as e:
            logger.warning("Meshy 3D generation trigger failed for upload %s: %s", upload_id, e)
            meshy_status = "FAILED"

        final_is_system = False
        if is_system:
            if (current_user and current_user.role == "admin") or user_uid in set(self.settings.ADMIN_UIDS):
                final_is_system = True

        furniture_dict = {
            "id": upload_id,
            "projectId": project_id,
            "ownerUid": user_uid,
            "fileName": file_name,
            "furnitureName": derived_name,
            "furnitureType": (furniture_type or "unknown").strip().lower(),
            "componentId": component_id,
            "contentType": content_type,
            "sizeBytes": size_bytes or 0,
            "bucket": self.storage_service.bucket_name,
            "storagePath": blob_path,
            "gcsUri": f"gs://{self.storage_service.bucket_name}/{blob_path}",
            "signedUrl": signed_display_url,
            "signedUrlExpiresAt": expires_at.isoformat(),
            "status": current_status,
            "meshyTaskId": meshy_task_id,
            "meshyStatus": meshy_status,
            "meshyProgress": 0,
            "is_system": final_is_system,
            "isSystem": final_is_system,
            "uploadedAt": now.isoformat(),
        }

        # Save in subcollection projects/{project_id}/furnitureImages/{upload_id}
        project_ref.collection("furnitureImages").document(upload_id).set({
            **furniture_dict,
            "uploadedAt": firestore.SERVER_TIMESTAMP,
        })

        current_count = int(project_data.get("furnitureCount") or 0) + 1
        project_ref.update({
            "hasFurniture": True,
            "furnitureCount": current_count,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        logger.info(
            "Furniture uploaded successfully for project %s (uploadId: %s, path: %s, meshyTaskId: %s)",
            project_id,
            upload_id,
            blob_path,
            meshy_task_id,
        )

        return self._dict_to_furniture_image(furniture_dict, project_id, user_uid, upload_id)

    def _dict_to_furniture_image(
        self,
        f_data: dict,
        project_id: str,
        user_uid: str,
        furniture_id: str,
    ) -> FurnitureImage:
        """Helper to convert a Firestore dictionary into a FurnitureImage Pydantic model."""
        glb_stream_url = f"{self.settings.API_V1_STR}/projects/{project_id}/furniture/{furniture_id}/glb"
        is_system = bool(f_data.get("is_system", f_data.get("isSystem", False)))
        return FurnitureImage(
            id=f_data.get("id") or furniture_id,
            project_id=f_data.get("projectId") or project_id,
            owner_uid=f_data.get("ownerUid") or user_uid,
            file_name=f_data.get("fileName") or "",
            furniture_name=f_data.get("furnitureName"),
            furniture_type=f_data.get("furnitureType") or "unknown",
            component_id=f_data.get("componentId"),
            content_type=f_data.get("contentType") or "image/png",
            size_bytes=f_data.get("sizeBytes") or 0,
            bucket=f_data.get("bucket") or self.storage_service.bucket_name,
            storage_path=f_data.get("storagePath") or "",
            gcs_uri=f_data.get("gcsUri") or "",
            signed_url=f_data.get("signedUrl") or "",
            signed_url_expires_at=self._normalize_datetime(f_data.get("signedUrlExpiresAt")),
            status=f_data.get("status") or "uploaded",
            meshy_task_id=f_data.get("meshyTaskId"),
            meshy_status=f_data.get("meshyStatus"),
            meshy_progress=f_data.get("meshyProgress") or 0,
            model_urls=f_data.get("modelUrls"),
            thumbnail_3d_url=f_data.get("thumbnail3dUrl"),
            glb_storage_path=f_data.get("glbStoragePath"),
            glb_stream_url=glb_stream_url,
            is_system=is_system,
            uploaded_at=self._normalize_datetime(f_data.get("uploadedAt")),
        )

    def list_project_furniture(self, project_id: str, user_uid: str) -> List[FurnitureImage]:
        """List all uploaded furniture photos for a project with refreshed signed display URLs."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to access this project",
                code="PROJECT_ACCESS_DENIED",
            )

        furniture_docs = project_ref.collection("furnitureImages").stream()
        items: List[FurnitureImage] = []
        for f_doc in furniture_docs:
            f_data = f_doc.to_dict() or {}
            f_data = self._refresh_furniture_signed_url(f_data)
            try:
                items.append(self._dict_to_furniture_image(f_data, project_id, user_uid, f_doc.id))
            except Exception as e:
                logger.warning("Failed to validate furniture record %s: %s", f_doc.id, e)

        # Sort latest uploaded first
        items.sort(
            key=lambda x: x.uploaded_at or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc),
            reverse=True,
        )
        return items

    def list_all_user_furniture(self, user_uid: str) -> List[FurnitureImage]:
        """List all uploaded furniture photos across all projects belonging to user with refreshed signed URLs. Excludes system assets."""
        user_projects = self.list_projects(user_uid)
        all_items: List[FurnitureImage] = []
        for p in user_projects:
            furn_docs = self.db.collection("projects").document(p.id).collection("furnitureImages").stream()
            for f_doc in furn_docs:
                f_data = f_doc.to_dict() or {}
                # Exclude system assets — "Your assets" is strictly user-uploaded furniture
                if f_data.get("is_system") or f_data.get("isSystem"):
                    continue
                gcs_uri = str(f_data.get("gcsUri") or "")
                storage_path = str(f_data.get("storagePath") or "")
                signed_url = str(f_data.get("signedUrl") or "")
                if gcs_uri.startswith("system://") or storage_path.startswith("assets/") or signed_url.startswith("assets/"):
                    continue

                f_data = self._refresh_furniture_signed_url(f_data)
                try:
                    all_items.append(self._dict_to_furniture_image(f_data, p.id, user_uid, f_doc.id))
                except Exception as e:
                    logger.warning("Failed to validate furniture record %s: %s", f_doc.id, e)

        all_items.sort(
            key=lambda x: x.uploaded_at or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc),
            reverse=True,
        )
        return all_items

    def choose_asset_for_project(
        self,
        project_id: str,
        user_uid: str,
        request: ChooseAssetRequest,
    ) -> FurnitureImage:
        """Add or assign a System Asset or existing User Asset to the target project."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()
        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        asset_id = f"asst_{uuid.uuid4().hex[:12]}"
        now = datetime.datetime.now(datetime.timezone.utc)

        derived_name = (
            request.furniture_name.strip()
            if request.furniture_name and request.furniture_name.strip()
            else request.asset_file_name.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").title()
        )

        if request.source_type == "user" and request.source_project_id and request.source_furniture_id:
            src_proj_ref = self.db.collection("projects").document(request.source_project_id)
            src_furn_doc = src_proj_ref.collection("furnitureImages").document(request.source_furniture_id).get()
            src_data = src_furn_doc.to_dict() if src_furn_doc.exists else {}

            furniture_dict = {
                "id": asset_id,
                "projectId": project_id,
                "ownerUid": user_uid,
                "fileName": src_data.get("fileName", request.asset_file_name),
                "furnitureName": request.furniture_name or src_data.get("furnitureName", derived_name),
                "furnitureType": request.furniture_type or src_data.get("furnitureType", "unknown"),
                "componentId": request.component_id,
                "contentType": src_data.get("contentType", "image/png"),
                "sizeBytes": src_data.get("sizeBytes", 0),
                "bucket": src_data.get("bucket", self.storage_service.bucket_name),
                "storagePath": src_data.get("storagePath", ""),
                "gcsUri": src_data.get("gcsUri", ""),
                "signedUrl": src_data.get("signedUrl", ""),
                "signedUrlExpiresAt": src_data.get("signedUrlExpiresAt"),
                "status": src_data.get("status", "uploaded"),
                "meshyTaskId": src_data.get("meshyTaskId"),
                "meshyStatus": src_data.get("meshyStatus"),
                "meshyProgress": src_data.get("meshyProgress", 0),
                "modelUrls": src_data.get("modelUrls"),
                "thumbnail3dUrl": src_data.get("thumbnail3dUrl"),
                "glbStoragePath": src_data.get("glbStoragePath"),
                "glbStreamUrl": src_data.get("glbStreamUrl"),
                "is_system": False,
                "uploadedAt": now.isoformat(),
            }
        else:
            # System Asset — already has high-fidelity 3D model generated!
            style_subpath = (
                f"assets/{request.style}/{request.asset_file_name}"
                if request.style
                else f"assets/{request.asset_file_name}"
            )
            glb_filename = request.asset_file_name.rsplit(".", 1)[0] + ".glb"
            glb_style_subpath = (
                f"assets/{request.style}/{glb_filename}"
                if request.style
                else f"assets/{glb_filename}"
            )
            model_urls = {"glb": self.catalog_url(glb_style_subpath)}

            furniture_dict = {
                "id": asset_id,
                "projectId": project_id,
                "ownerUid": user_uid,
                "fileName": request.asset_file_name,
                "furnitureName": derived_name,
                "furnitureType": (request.furniture_type or "unknown").strip().lower(),
                "componentId": request.component_id,
                "contentType": "image/png",
                "sizeBytes": 0,
                "bucket": self.storage_service.bucket_name,
                "storagePath": style_subpath,
                "gcsUri": f"system://{style_subpath}",
                "signedUrl": self.catalog_url(style_subpath),
                "signedUrlExpiresAt": None,
                "status": "3d_ready",
                "meshyTaskId": "system_catalog_preset",
                "meshyStatus": "SUCCEEDED",
                "meshyProgress": 100,
                "modelUrls": model_urls,
                "thumbnail3dUrl": None,
                "glbStoragePath": glb_style_subpath,
                "is_system": True,
                "uploadedAt": now.isoformat(),
            }

        project_ref.collection("furnitureImages").document(asset_id).set(furniture_dict)

        current_count = project_data.get("furnitureCount", 0)
        project_ref.update({
            "hasFurniture": True,
            "furnitureCount": current_count + 1,
            "updatedAt": now.isoformat(),
        })

        return self._dict_to_furniture_image(furniture_dict, project_id, user_uid, asset_id)


    def get_furniture_3d_status(self, project_id: str, user_uid: str, furniture_id: str) -> FurnitureImage:
        """Poll and synchronize Meshy 3D generation status for a project furniture item."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()
        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to access this project",
                code="PROJECT_ACCESS_DENIED",
            )

        furn_ref = project_ref.collection("furnitureImages").document(furniture_id)
        f_doc = furn_ref.get()
        if not f_doc.exists:
            raise NotFoundException(detail="Furniture item not found", code="FURNITURE_NOT_FOUND")

        f_data = f_doc.to_dict() or {}
        task_id = f_data.get("meshyTaskId")

        if task_id and self.meshy_service.is_configured:
            try:
                task_result = self.meshy_service.get_task_status(task_id)
                meshy_status = task_result.get("status")
                meshy_progress = task_result.get("progress", 0)
                model_urls = task_result.get("model_urls")
                thumbnail_3d = task_result.get("thumbnail_url")

                update_fields = {
                    "meshyStatus": meshy_status,
                    "meshyProgress": meshy_progress,
                }
                if thumbnail_3d:
                    update_fields["thumbnail3dUrl"] = thumbnail_3d
                if meshy_status == "SUCCEEDED":
                    update_fields["status"] = "3d_ready"
                elif meshy_status == "FAILED":
                    update_fields["status"] = "failed_3d"

                # If Meshy generated 3D model succeeded, auto-cache the GLB file to GCS
                # This bypasses Meshy's CDN CORS restrictions and provides high-speed WebGL loading
                glb_storage_path = f_data.get("glbStoragePath") or f"{user_uid}/{project_id}/furniture/{furniture_id}.glb"
                raw_glb_url = model_urls.get("glb") if (isinstance(model_urls, dict)) else None

                if raw_glb_url and meshy_status == "SUCCEEDED":
                    try:
                        if not self.storage_service.blob_exists(glb_storage_path):
                            logger.info("Downloading generated GLB from Meshy to cache in GCS at %s...", glb_storage_path)
                            import requests
                            glb_resp = requests.get(raw_glb_url, timeout=60)
                            if glb_resp.status_code == 200:
                                self.storage_service.upload_bytes(
                                    data=glb_resp.content,
                                    blob_path=glb_storage_path,
                                    content_type="model/gltf-binary",
                                )
                                logger.info("Successfully cached Meshy GLB to GCS (%d bytes)", len(glb_resp.content))

                        if self.storage_service.blob_exists(glb_storage_path):
                            fresh_glb_url = self.storage_service.generate_signed_read_url(glb_storage_path)
                            model_urls["meshyGlb"] = raw_glb_url
                            model_urls["glb"] = fresh_glb_url
                            update_fields["glbStoragePath"] = glb_storage_path
                    except Exception as ge:
                        logger.warning("Could not auto-cache Meshy GLB to GCS: %s", ge)

                if model_urls:
                    update_fields["modelUrls"] = model_urls

                furn_ref.update(update_fields)
                f_data.update(update_fields)
            except Exception as e:
                logger.warning("Failed to refresh Meshy 3D task status for %s: %s", task_id, e)

        f_data = self._refresh_furniture_signed_url(f_data)
        return self._dict_to_furniture_image(f_data, project_id, user_uid, furniture_id)

    def generate_furniture_3d(self, project_id: str, user_uid: str, furniture_id: str) -> FurnitureImage:
        """Trigger or re-trigger Meshy 3D generation for an existing furniture image."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()
        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to access this project",
                code="PROJECT_ACCESS_DENIED",
            )

        furn_ref = project_ref.collection("furnitureImages").document(furniture_id)
        f_doc = furn_ref.get()
        if not f_doc.exists:
            raise NotFoundException(detail="Furniture item not found", code="FURNITURE_NOT_FOUND")

        f_data = f_doc.to_dict() or {}
        f_data = self._refresh_furniture_signed_url(f_data)

        # If system asset, 3D is already generated — never call Meshy or generate again
        if self._is_system_item(f_data):
            update_fields = {
                "meshyStatus": "SUCCEEDED",
                "meshyProgress": 100,
                "status": "3d_ready",
            }
            furn_ref.update(update_fields)
            f_data.update(update_fields)
            return self._dict_to_furniture_image(f_data, project_id, user_uid, furniture_id)

        image_url = None
        storage_path = f_data.get("storagePath")
        if storage_path:
            try:
                blob = self.storage_service.bucket.blob(storage_path)
                blob_bytes = blob.download_as_bytes()
                if blob_bytes and len(blob_bytes) <= 25 * 1024 * 1024:
                    mime = f_data.get("contentType") or "image/jpeg"
                    b64_data = base64.b64encode(blob_bytes).decode("utf-8")
                    image_url = f"data:{mime};base64,{b64_data}"
            except Exception as ex:
                logger.warning("Could not convert stored furniture to data URI: %s", ex)

        if not image_url:
            image_url = f_data.get("signedUrl")

        task_id = self.meshy_service.create_image_to_3d_task(
            image_url=image_url,
            resolution="standard",
            texture_allowed=True,
            enhancement_allowed=True,
        )

        update_fields = {
            "meshyTaskId": task_id,
            "meshyStatus": "PENDING",
            "meshyProgress": 0,
            "status": "generating_3d",
        }
        furn_ref.update(update_fields)
        f_data.update(update_fields)
        return self._dict_to_furniture_image(f_data, project_id, user_uid, furniture_id)

    def delete_project_furniture(self, project_id: str, user_uid: str, furniture_id: str) -> bool:
        """Delete a specific furniture photo from Storage and Firestore."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        furn_ref = project_ref.collection("furnitureImages").document(furniture_id)
        furn_doc = furn_ref.get()

        if not furn_doc.exists:
            raise NotFoundException(detail="Furniture item not found", code="FURNITURE_NOT_FOUND")

        furn_data = furn_doc.to_dict() or {}
        storage_path = furn_data.get("storagePath")
        if storage_path:
            self.storage_service.delete_blob(storage_path)

        furn_ref.delete()

        current_count = max(0, int(project_data.get("furnitureCount") or 1) - 1)
        project_ref.update({
            "furnitureCount": current_count,
            "hasFurniture": current_count > 0,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        logger.info("Deleted furniture %s from project %s", furniture_id, project_id)
        return True

    def delete_user_furniture_by_id(self, user_uid: str, furniture_id: str) -> bool:
        """Find and delete a user's uploaded furniture item across any of their projects."""
        user_projects = self.list_projects(user_uid)
        for p in user_projects:
            furn_ref = self.db.collection("projects").document(p.id).collection("furnitureImages").document(furniture_id)
            if furn_ref.get().exists:
                return self.delete_project_furniture(project_id=p.id, user_uid=user_uid, furniture_id=furniture_id)
        raise NotFoundException(detail="Furniture item not found", code="FURNITURE_NOT_FOUND")

    def update_furniture_system(
        self,
        project_id: str,
        furniture_id: str,
        is_system: bool,
        current_user: UserProfile,
    ) -> FurnitureImage:
        """Update the is_system field for a furniture image. Only Admin users can adjust this field."""
        if current_user.role != "admin":
            raise ForbiddenException(
                detail="Only Admin can adjust the is_system field.",
                code="ADMIN_REQUIRED",
            )

        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()
        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        furn_ref = project_ref.collection("furnitureImages").document(furniture_id)
        f_doc = furn_ref.get()
        if not f_doc.exists:
            raise NotFoundException(detail="Furniture item not found", code="FURNITURE_NOT_FOUND")

        f_data = f_doc.to_dict() or {}
        now = datetime.datetime.now(datetime.timezone.utc)
        updates = {
            "is_system": is_system,
            "isSystem": is_system,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        furn_ref.update(updates)
        f_data.update(updates)
        f_data["updatedAt"] = now.isoformat()

        f_data = self._refresh_furniture_signed_url(f_data)
        logger.info(
            "Admin %s successfully updated furniture %s in project %s: is_system=%s",
            current_user.uid,
            furniture_id,
            project_id,
            is_system,
        )
        return self._dict_to_furniture_image(
            f_data,
            project_id,
            project_data.get("ownerUid", current_user.uid),
            furniture_id,
        )

    def update_furniture(
        self,
        project_id: str,
        furniture_id: str,
        request: UpdateFurnitureRequest,
        current_user: UserProfile,
    ) -> FurnitureImage:
        """Update mutable furniture fields. Only Admin can adjust is_system."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()
        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        is_owner = project_data.get("ownerUid") == current_user.uid
        is_admin = current_user.role == "admin"

        if not is_owner and not is_admin:
            raise ForbiddenException(
                detail="You do not have permission to modify this project's furniture",
                code="PROJECT_ACCESS_DENIED",
            )

        furn_ref = project_ref.collection("furnitureImages").document(furniture_id)
        f_doc = furn_ref.get()
        if not f_doc.exists:
            raise NotFoundException(detail="Furniture item not found", code="FURNITURE_NOT_FOUND")

        f_data = f_doc.to_dict() or {}
        now = datetime.datetime.now(datetime.timezone.utc)
        updates = {"updatedAt": firestore.SERVER_TIMESTAMP}

        if request.is_system is not None:
            if not is_admin:
                raise ForbiddenException(
                    detail="Only Admin can adjust the is_system field.",
                    code="ADMIN_REQUIRED",
                )
            updates["is_system"] = request.is_system
            updates["isSystem"] = request.is_system

        if request.furniture_name is not None:
            updates["furnitureName"] = request.furniture_name
        if request.furniture_type is not None:
            updates["furnitureType"] = (request.furniture_type or "unknown").strip().lower()
        if request.component_id is not None:
            updates["componentId"] = request.component_id

        furn_ref.update(updates)
        f_data.update(updates)
        f_data["updatedAt"] = now.isoformat()
        f_data = self._refresh_furniture_signed_url(f_data)
        return self._dict_to_furniture_image(
            f_data,
            project_id,
            project_data.get("ownerUid", current_user.uid),
            furniture_id,
        )

    def _refresh_furniture_signed_url(self, item: dict) -> dict:
        """Refresh signed display URL for a furniture item."""
        if self._is_system_item(item):
            storage_path = item.get("storagePath") or ""
            if storage_path.startswith("assets/"):
                item["signedUrl"] = self.catalog_url(storage_path)
            # Preset catalog items always ship with a ready GLB
            item["status"] = "3d_ready"
            item["meshyStatus"] = "SUCCEEDED"
            item["meshyProgress"] = 100
            glb_path = item.get("glbStoragePath") or (
                storage_path.rsplit(".", 1)[0] + ".glb" if storage_path else ""
            )
            model_urls = item.get("modelUrls") if isinstance(item.get("modelUrls"), dict) else {}
            glb = model_urls.get("glb") or glb_path
            if glb:
                model_urls["glb"] = self.catalog_url(glb)
            item["modelUrls"] = model_urls
            return item

        storage_path = item.get("storagePath")
        if storage_path and not storage_path.startswith("assets/"):
            fresh_url = self.storage_service.generate_signed_read_url(storage_path)
            item["signedUrl"] = fresh_url
            expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
                seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS
            )
            item["signedUrlExpiresAt"] = expires_at.isoformat()
        elif storage_path:
            item["signedUrl"] = storage_path

        # Refresh GLB signed URL if cached in GCS
        glb_storage_path = item.get("glbStoragePath")
        if glb_storage_path:
            try:
                fresh_glb_url = self.storage_service.generate_signed_read_url(glb_storage_path)
                model_urls = item.get("modelUrls")
                if not isinstance(model_urls, dict):
                    model_urls = {}
                model_urls["glb"] = fresh_glb_url
                item["modelUrls"] = model_urls
            except Exception as e:
                logger.warning("Could not refresh GLB signed URL for %s: %s", glb_storage_path, e)
        return item

    def get_furniture_glb_bytes(self, project_id: str, furniture_id: str) -> tuple[bytes, str]:
        """Fetch raw bytes of the 3D GLB model for a furniture item, serving directly with CORS."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()
        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        furn_ref = project_ref.collection("furnitureImages").document(furniture_id)
        f_doc = furn_ref.get()
        if not f_doc.exists:
            raise NotFoundException(detail="Furniture item not found", code="FURNITURE_NOT_FOUND")

        f_data = f_doc.to_dict() or {}
        furn_name = f_data.get("furnitureName") or f_data.get("fileName") or "furniture"
        clean_name = "".join(c for c in furn_name if c.isalnum() or c in ("-", "_")).rstrip()
        filename = f"{clean_name or 'furniture'}.glb"

        # Preset catalog items live in the public catalog bucket under assets/{Style}/
        if self._is_system_item(f_data):
            storage_path = f_data.get("glbStoragePath") or f_data.get("storagePath", "")
            glb_path = storage_path.rsplit(".", 1)[0] + ".glb"
            blob = self.storage_service.catalog_bucket.blob(glb_path)
            if blob.exists():
                return blob.download_as_bytes(), filename
            raise NotFoundException(detail="Catalog GLB not found", code="GLB_NOT_READY")

        glb_storage_path = f_data.get("glbStoragePath")
        if glb_storage_path and self.storage_service.blob_exists(glb_storage_path):
            blob = self.storage_service.bucket.blob(glb_storage_path)
            content = blob.download_as_bytes()
            return content, filename

        # Fallback: if not yet cached in GCS, check if modelUrls has a GLB to fetch and cache
        model_urls = f_data.get("modelUrls") or {}
        remote_url = model_urls.get("meshyGlb") or model_urls.get("glb")
        if remote_url:
            import requests
            resp = requests.get(remote_url, timeout=60)
            if resp.status_code == 200:
                owner_uid = f_data.get("ownerUid", "unknown")
                cache_path = f"{owner_uid}/{project_id}/furniture/{furniture_id}.glb"
                try:
                    self.storage_service.upload_bytes(
                        data=resp.content,
                        blob_path=cache_path,
                        content_type="model/gltf-binary",
                    )
                    furn_ref.update({"glbStoragePath": cache_path})
                except Exception as ce:
                    logger.warning("Could not cache fetched GLB: %s", ce)
                return resp.content, filename

        raise NotFoundException(detail="3D GLB model is not available yet", code="GLB_NOT_READY")

    def delete_project(self, project_id: str, user_uid: str) -> bool:
        """Delete project and any associated plan image in Storage."""
        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        data = doc.to_dict() or {}
        if data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to delete this project",
                code="PROJECT_ACCESS_DENIED",
            )

        # Delete plan blob from storage if exists
        plan_image = data.get("planImage")
        if plan_image and plan_image.get("storagePath"):
            self.storage_service.delete_blob(plan_image["storagePath"])
        # Clean up any files stored under {user_id}/{project_id}/
        self.storage_service.delete_prefix(f"{user_uid}/{project_id}/")

        # Delete subcollection documents
        plan_images = project_ref.collection("planImages").stream()
        for p_doc in plan_images:
            p_doc.reference.delete()

        furniture_images = project_ref.collection("furnitureImages").stream()
        for f_doc in furniture_images:
            f_doc.reference.delete()

        project_ref.delete()
        logger.info("Deleted project %s for user %s", project_id, user_uid)
        return True

    def _check_project_quota(self, user_uid: str):
        """Verify user has not exceeded their plan project quota."""
        user_doc = self.db.collection("users").document(user_uid).get()
        if user_doc.exists:
            user_data = user_doc.to_dict() or {}
            max_projects = user_data.get("quota", {}).get("projects", 5)
        else:
            max_projects = 5

        try:
            current_projects = list(
                self.db.collection("projects")
                .where(filter=FieldFilter("ownerUid", "==", user_uid))
                .stream()
            )
        except (TypeError, Exception):
            current_projects = list(
                self.db.collection("projects")
                .where("ownerUid", "==", user_uid)
                .stream()
            )
        if len(current_projects) >= max_projects:
            raise QuotaExceededException(
                detail=(
                    f"Project quota reached ({len(current_projects)}/{max_projects}). "
                    "Upgrade your plan to create more projects."
                ),
                code="QUOTA_EXCEEDED",
            )

    def _validate_content_type(self, content_type: str, file_name: str):
        """Ensure file is an accepted floor plan format (sketch, PDF, screenshot)."""
        normalized_type = (content_type or "").lower().strip()
        if not normalized_type or normalized_type == "application/octet-stream":
            guessed, _ = mimetypes.guess_type(file_name)
            if guessed:
                normalized_type = guessed.lower()

        if normalized_type not in self.settings.ALLOWED_CONTENT_TYPES:
            raise AppException(
                status_code=400,
                code="UNSUPPORTED_FILE_TYPE",
                detail=(
                    f"Unsupported file format '{content_type}'. "
                    "Please upload a floor plan sketch or screenshot (PNG, JPEG, WebP) or PDF."
                ),
            )

    def _get_extension(self, file_name: str, content_type: str) -> str:
        """Derive safe file extension from filename or MIME type."""
        _, ext = os.path.splitext(file_name)
        if ext:
            clean_ext = ext.lower()
            if clean_ext in [".png", ".jpg", ".jpeg", ".webp", ".pdf"]:
                return clean_ext

        mime_to_ext = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/webp": ".webp",
            "application/pdf": ".pdf",
        }
        return mime_to_ext.get(content_type.lower(), ".png")

    def _refresh_plan_signed_url(self, plan_data: dict) -> dict:
        """Refresh signed read URL if the plan data contains storage path."""
        storage_path = plan_data.get("storagePath")
        if storage_path:
            fresh_url = self.storage_service.generate_signed_read_url(storage_path)
            plan_data["signedUrl"] = fresh_url
            expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
                seconds=self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS
            )
            plan_data["signedUrlExpiresAt"] = expires_at.isoformat()
        return plan_data

    @staticmethod
    def _normalize_datetime(val) -> Optional[datetime.datetime]:
        """Convert various datetime formats or Firestore sentinels to datetime object."""
        if val is None:
            return None
        if isinstance(val, datetime.datetime):
            return val
        if isinstance(val, str):
            try:
                return datetime.datetime.fromisoformat(val)
            except Exception:
                pass
        return datetime.datetime.now(datetime.timezone.utc)

    def _worker_base_url(self) -> str:
        return self.settings.PLAN_PARSER_WORKER_URL.rstrip("/")

    def _worker_auth_headers(self) -> Dict[str, str]:
        """Google ID token for the private Cloud Run worker (audience = worker base URL)."""
        if not self.settings.WORKER_REQUIRES_AUTH:
            return {}
        import google.auth.transport.requests
        import google.oauth2.id_token

        token = google.oauth2.id_token.fetch_id_token(
            google.auth.transport.requests.Request(), self._worker_base_url()
        )
        return {"Authorization": f"Bearer {token}"}

    def trigger_plan_parsing(self, project_id: str, user_uid: str) -> dict:
        """Trigger floor plan parsing worker via Cloud Tasks or async dispatch."""
        import json
        import threading
        import requests

        project_ref = self.db.collection("projects").document(project_id)
        doc = project_ref.get()

        if not doc.exists:
            raise NotFoundException(detail="Project not found", code="PROJECT_NOT_FOUND")

        project_data = doc.to_dict() or {}
        if project_data.get("ownerUid") != user_uid:
            raise ForbiddenException(
                detail="You do not have permission to modify this project",
                code="PROJECT_ACCESS_DENIED",
            )

        if not project_data.get("hasPlan") or not project_data.get("planImage"):
            raise AppException(
                status_code=400,
                code="NO_PLAN_UPLOADED",
                detail="Please upload a floor plan image, sketch, or PDF first before starting parsing.",
            )

        plan_image = project_data["planImage"]
        # Ensure signed display URL is fresh
        plan_image = self._refresh_plan_signed_url(plan_image)

        # 1. Create Job in Firestore jobs/{jobId}
        job_ref = self.db.collection("jobs").document()
        job_id = job_ref.id
        now = datetime.datetime.now(datetime.timezone.utc)

        task_payload = {
            "jobId": job_id,
            "projectId": project_id,
            "ownerUid": user_uid,
            "gcsPath": plan_image.get("storagePath"),
            "signedUrl": plan_image.get("signedUrl"),
            "uploadId": plan_image.get("id"),
            "fileName": plan_image.get("fileName"),
            "contentType": plan_image.get("contentType", "image/png"),
        }

        job_data = {
            "id": job_id,
            "type": "plan_parse",
            "projectId": project_id,
            "ownerUid": user_uid,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
            "input": task_payload,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        job_ref.set(job_data)

        # 2. Update Project document state
        project_ref.update({
            "status": "processing",
            "currentJobId": job_id,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })

        logger.info(
            "Created plan parsing job %s for project %s (owner: %s)",
            job_id,
            project_id,
            user_uid,
        )

        # 3. Trigger worker via Cloud Tasks if configured, else async HTTP dispatch
        dispatched_cloud_task = False
        if self.settings.CLOUD_TASKS_QUEUE:
            try:
                from google.cloud import tasks_v2

                tasks_client = tasks_v2.CloudTasksClient()
                worker_url = f"{self._worker_base_url()}/tasks/parse-plan"
                http_request = {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": worker_url,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps(task_payload).encode("utf-8"),
                }
                if self.settings.TASKS_INVOKER_SA:
                    http_request["oidc_token"] = {
                        "service_account_email": self.settings.TASKS_INVOKER_SA,
                        "audience": self._worker_base_url(),
                    }
                task = {"http_request": http_request, "dispatch_deadline": {"seconds": 600}}
                tasks_client.create_task(parent=self.settings.CLOUD_TASKS_QUEUE, task=task)
                logger.info("Successfully enqueued Cloud Task for job %s", job_id)
                dispatched_cloud_task = True
            except Exception as e:
                logger.warning(
                    "Cloud Tasks enqueue failed: %s. Falling back to direct worker dispatch.",
                    e,
                )

        if not dispatched_cloud_task:
            # Direct async HTTP trigger in background thread
            worker_endpoint = f"{self._worker_base_url()}/tasks/parse-plan"

            def _trigger_worker():
                try:
                    logger.info("Dispatching task to worker endpoint: %s", worker_endpoint)
                    resp = requests.post(
                        worker_endpoint,
                        json=task_payload,
                        headers=self._worker_auth_headers(),
                        timeout=600,
                    )
                    logger.info("Worker response for job %s: status %d", job_id, resp.status_code)
                except Exception as err:
                    logger.error("Failed to trigger plan parser worker for job %s: %s", job_id, err)

            thread = threading.Thread(target=_trigger_worker, daemon=True)
            thread.start()

        return {
            "jobId": job_id,
            "projectId": project_id,
            "status": "queued",
            "progress": 0,
            "createdAt": now.isoformat(),
        }

    def get_job(self, job_id: str, user_uid: str) -> dict:
        """Retrieve job status, progress and result from Firestore jobs/{jobId}."""
        doc = self.db.collection("jobs").document(job_id).get()
        if not doc.exists:
            raise NotFoundException(detail="Job not found", code="JOB_NOT_FOUND")

        data = doc.to_dict() or {}
        if data.get("ownerUid") and data.get("ownerUid") != user_uid:
            raise ForbiddenException(detail="Access denied to job", code="JOB_ACCESS_DENIED")

        return self._fail_if_stale(job_id, data)

    def _fail_if_stale(self, job_id: str, data: dict) -> dict:
        """Mark a job failed when the worker stopped updating it (lost dispatch, crash)."""
        if data.get("status") not in ("queued", "running"):
            return data
        updated_at = self._normalize_datetime(data.get("updatedAt") or data.get("createdAt"))
        if not updated_at:
            return data
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=datetime.timezone.utc)
        age = (datetime.datetime.now(datetime.timezone.utc) - updated_at).total_seconds()
        if age < self.settings.JOB_STALE_SECONDS:
            return data

        error = f"Job timed out: no progress for {int(age)}s"
        logger.warning("Marking job %s failed: %s", job_id, error)
        self.db.collection("jobs").document(job_id).update({
            "status": "failed",
            "stage": "failed",
            "error": error,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        if data.get("projectId"):
            self.db.collection("projects").document(data["projectId"]).update({
                "status": "failed",
                "lastError": error,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        return {**data, "status": "failed", "stage": "failed", "error": error}

    def get_project_plan(self, project_id: str, user_uid: str) -> dict:
        """Retrieve parsed floor plan data for a project."""
        project = self.get_project(project_id, user_uid)
        doc = self.db.collection("projects").document(project_id).get()
        data = doc.to_dict() or {}
        floor_plan = data.get("floorPlan")
        if not floor_plan:
            raise NotFoundException(
                detail="Floor plan has not been parsed yet for this project.",
                code="FLOOR_PLAN_NOT_PARSED",
            )
        return floor_plan

    def _dict_to_project(self, data: dict) -> Project:
        """Safely convert Firestore document dictionary to Project Pydantic model."""
        created_at = self._normalize_datetime(data.get("createdAt"))
        updated_at = self._normalize_datetime(data.get("updatedAt"))
        plan_data = data.get("planImage")
        plan_image: Optional[PlanImage] = None

        if plan_data and isinstance(plan_data, dict):
            plan_image = PlanImage(
                id=plan_data.get("id"),
                project_id=plan_data.get("projectId") or data.get("id"),
                owner_uid=plan_data.get("ownerUid") or data.get("ownerUid"),
                file_name=plan_data.get("fileName"),
                content_type=plan_data.get("contentType"),
                size_bytes=plan_data.get("sizeBytes", 0),
                bucket=plan_data.get("bucket") or self.storage_service.bucket_name,
                storage_path=plan_data.get("storagePath"),
                gcs_uri=plan_data.get("gcsUri"),
                signed_url=plan_data.get("signedUrl"),
                signed_url_expires_at=self._normalize_datetime(plan_data.get("signedUrlExpiresAt")),
                uploaded_at=self._normalize_datetime(plan_data.get("uploadedAt")),
            )

        return Project(
            id=data.get("id"),
            owner_uid=data.get("ownerUid"),
            name=data.get("name"),
            description=data.get("description"),
            status=data.get("status", "created"),
            has_plan=bool(data.get("hasPlan", False)),
            plan_image=plan_image,
            current_job_id=data.get("currentJobId"),
            has_plan_parsed=bool(data.get("hasPlanParsed", False) or data.get("floorPlan")),
            floor_plan=data.get("floorPlan"),
            has_furniture=bool(data.get("hasFurniture", False)),
            furniture_count=int(data.get("furnitureCount", 0)),
            created_at=created_at,
            updated_at=updated_at,
        )

    def remove_furniture_background(
        self,
        image_bytes: bytes,
        filename: str,
        content_type: str,
        furniture_name: str,
    ) -> Dict[str, Any]:
        """Forward furniture image to plan parser worker gpt-6-sol for transparent background."""
        worker_url = f"{self._worker_base_url()}/api/furniture/transparent-background"
        files = {"file": (filename, image_bytes, content_type)}
        data = {"furniture_name": furniture_name}
        logger.info("Forwarding furniture transparent background request to worker: %s", worker_url)
        resp = requests.post(
            worker_url,
            files=files,
            data=data,
            headers=self._worker_auth_headers(),
            timeout=300,
        )
        if resp.status_code != 200:
            logger.error("Worker transparent background failed (%d): %s", resp.status_code, resp.text)
            raise RuntimeError(f"Worker transparent background error: {resp.text}")
        return resp.json()
