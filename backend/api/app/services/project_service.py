import datetime
import logging
import requests
from typing import Any, Dict, List, Optional
from firebase_admin import firestore
from google.cloud import firestore as gcloud_firestore
from google.cloud.firestore import FieldFilter

from ..config import get_settings
from ..errors import (
    AppException,
    ForbiddenException,
    NotFoundException,
    QuotaExceededException,
)
from ..models.project import PlanImage, Project
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

        for sub in ("furnitureImages", "floorPlans"):
            for s_doc in project_ref.collection(sub).stream():
                s_doc.reference.delete()

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

    def trigger_plan_parsing(self, project_id: str, user_uid: str, cropped: bool = False) -> dict:
        """Trigger floor plan parsing worker via Cloud Tasks or async dispatch.

        `cropped`: the plan image is the user's tight crop, so the worker skips corner detection and
        reports back into conversations/{projectId} (plan_ready / plan_failed messages).
        """
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
            "cropped": cropped,
            "conversationId": project_data.get("conversationId") if cropped else None,
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
            conv_id = (data.get("input") or {}).get("conversationId")
            if conv_id:
                conv_ref = self.db.collection("conversations").document(conv_id)
                conv_ref.collection("messages").document().set({
                    "role": "system", "kind": "plan_failed", "text": "", "payload": {"error": error},
                    "status": "done", "createdAt": firestore.SERVER_TIMESTAMP,
                })
                conv_ref.update({
                    "stage": "cropping", "busy": False, "busyReason": None,
                    "lastMessagePreview": "We couldn't read the plan", "updatedAt": firestore.SERVER_TIMESTAMP,
                })
        return {**data, "status": "failed", "stage": "failed", "error": error}

    def get_project_plan(self, project_id: str, user_uid: str) -> dict:
        """Retrieve parsed floor plan data for a project."""
        self.get_project(project_id, user_uid)
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
