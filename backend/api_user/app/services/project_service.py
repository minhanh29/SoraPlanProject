import datetime
import logging
import mimetypes
import os
from typing import List, Optional
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
    PlanImage,
    Project,
    UploadUrlResponse,
)
from .storage_service import StorageService

logger = logging.getLogger("api_user.project_service")


class ProjectService:
    """Service handling project management and single-plan upload lifecycle."""

    def __init__(
        self,
        db: gcloud_firestore.Client,
        storage_service: Optional[StorageService] = None,
    ):
        self.db = db
        self.storage_service = storage_service or StorageService()
        self.settings = get_settings()

    @staticmethod
    def build_storage_path(user_uid: str, project_id: str, file_id: str, ext: str) -> str:
        """Build storage object path following structure: {user_id}/{project_id}/{files}."""
        return f"{user_uid}/{project_id}/{file_id}{ext}"

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
                worker_url = f"{self.settings.PLAN_PARSER_WORKER_URL.rstrip('/')}/tasks/parse-plan"
                task = {
                    "http_request": {
                        "http_method": tasks_v2.HttpMethod.POST,
                        "url": worker_url,
                        "headers": {"Content-Type": "application/json"},
                        "body": json.dumps(task_payload).encode("utf-8"),
                    }
                }
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
            worker_endpoint = f"{self.settings.PLAN_PARSER_WORKER_URL.rstrip('/')}/tasks/parse-plan"

            def _trigger_worker():
                try:
                    logger.info("Dispatching task to worker endpoint: %s", worker_endpoint)
                    resp = requests.post(worker_endpoint, json=task_payload, timeout=180)
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

        return data

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
            created_at=created_at,
            updated_at=updated_at,
        )
