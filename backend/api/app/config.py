import json
from functools import lru_cache
from typing import List, Optional, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


import os

_base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_env_file = os.path.join(_base_dir, ".env")

class Settings(BaseSettings):
    """Application settings and configuration parameters."""

    model_config = SettingsConfigDict(
        env_file=(_env_file, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENV: str = Field(default="development", description="Runtime environment")
    PORT: int = Field(default=8000, description="Listening port")
    HOST: str = Field(default="0.0.0.0", description="Listening host")
    API_V1_STR: str = Field(default="/v1", description="API V1 URL prefix")
    PROJECT_NAME: str = Field(default="SoraPlan User API", description="API Name")
    DEBUG: bool = Field(default=False, description="Debug mode")

    # Firebase configuration
    FIREBASE_PROJECT_ID: str = Field(
        default="soraplan",
        description="Google Cloud / Firebase Project ID",
    )
    FIREBASE_WEB_API_KEY: str = Field(
        default="",
        description="Firebase Web API Key for Identity Toolkit (env / Secret Manager)",
    )
    FIREBASE_CREDENTIALS_PATH: Optional[str] = Field(
        default=None,
        description="Local dev only: path to a service account JSON key. Unset on Cloud Run (uses ADC).",
    )
    ADMIN_UIDS: Union[List[str], str] = Field(
        default=[],
        description="Firebase UIDs allowed to manage the system catalog (comma-separated or JSON list)",
    )

    # Google Cloud Storage configuration
    GCS_BUCKET_NAME: str = Field(
        default="soraplan-assest-dev",
        description="Google Cloud Storage bucket for user uploads",
    )
    GCS_SIGNED_URL_EXPIRATION_SECONDS: int = Field(
        default=86400,
        description="Signed URL expiration in seconds (default 24h)",
    )
    CATALOG_BUCKET_NAME: str = Field(
        default="soraplan-catalog",
        description="Public-read bucket holding preset furniture under assets/{Style}/",
    )
    MAX_UPLOAD_SIZE_BYTES: int = Field(
        default=25 * 1024 * 1024,
        description="Maximum allowed file upload size in bytes (default 25MB)",
    )
    ALLOWED_CONTENT_TYPES: List[str] = Field(
        default=[
            "image/png",
            "image/jpeg",
            "image/jpg",
            "image/webp",
            "application/pdf",
        ],
        description="Permitted MIME types for sketch, PDF, and screenshot uploads",
    )

    # Plan Parser Worker & Cloud Tasks configuration
    PLAN_PARSER_WORKER_URL: str = Field(
        default="http://localhost:8001",
        description="URL of Cloud Run plan parser worker service",
    )
    CLOUD_TASKS_QUEUE: Optional[str] = Field(
        default=None,
        description="Optional full Cloud Tasks queue path: projects/{p}/locations/{l}/queues/{q}",
    )
    TASKS_INVOKER_SA: Optional[str] = Field(
        default=None,
        description="Service account email Cloud Tasks uses to mint the OIDC token for the worker",
    )
    WORKER_REQUIRES_AUTH: bool = Field(
        default=False,
        description="Attach a Google ID token when calling the worker (true on Cloud Run)",
    )
    JOB_STALE_SECONDS: int = Field(
        default=900,
        description="Queued/running jobs not updated for this long are marked failed",
    )

    # Meshy 3D Generation configuration
    MESHY_API_KEY: Optional[str] = Field(
        default=None,
        description="Meshy AI REST API key for generating 3D models from furniture photos",
    )
    MESHY_API_BASE_URL: str = Field(
        default="https://api.meshy.ai/openapi/v1",
        description="Meshy AI REST API base URL",
    )

    MESHY_POLL_QUEUE: Optional[str] = Field(
        default=None,
        description="Cloud Tasks queue path for Meshy status polling (projects/{p}/locations/{l}/queues/meshy-poll). "
        "Unset locally: a background thread polls instead.",
    )
    MESHY_POLL_INTERVAL_SECONDS: int = Field(default=15, description="Delay between Meshy status polls")
    MESHY_POLL_MAX_ATTEMPTS: int = Field(default=40, description="Polls before a generation is marked failed")
    API_PUBLIC_URL: Optional[str] = Field(
        default=None,
        description="This API's own base URL (no /v1). Cloud Tasks calls /internal/* on it; also the OIDC audience.",
    )

    # Gemini (chat orchestrator). Vertex AI with the service account by default (decision D2).
    GEMINI_CHAT_MODEL: str = Field(default="gemini-3.8-flash", description="Model for chat + tool calls")
    GEMINI_IMAGE_MODEL: str = Field(default="gemini-3.1-flash-image",
                                    description="Image model (Nano Banana 2) for the project thumbnail photo")
    GEMINI_LOCATION: str = Field(default="global", description="Vertex AI location for Gemini")
    GEMINI_API_KEY: Optional[str] = Field(
        default=None,
        description="Local dev only: use the Gemini API with a key instead of Vertex AI. Unset on Cloud Run.",
    )
    CHAT_HISTORY_MESSAGES: int = Field(default=20, description="Past messages sent to Gemini each turn")
    CHAT_MAX_TOOL_ROUNDS: int = Field(default=4, description="Model ↔ tool round trips per user turn")

    # CORS configuration
    CORS_ORIGINS: Union[List[str], str] = Field(
        default=[
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ],
        description="Allowed CORS origins (never '*': the API uses credentials)",
    )

    @property
    def catalog_base_url(self) -> str:
        return f"https://storage.googleapis.com/{self.CATALOG_BUCKET_NAME}"

    @field_validator("CORS_ORIGINS", "ADMIN_UIDS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            v_stripped = v.strip()
            if v_stripped.startswith("[") and v_stripped.endswith("]"):
                try:
                    return json.loads(v_stripped)
                except Exception:
                    pass
            return [i.strip() for i in v_stripped.split(",") if i.strip()]
        elif isinstance(v, (list, set)):
            return list(v)
        return []


@lru_cache()
def get_settings() -> Settings:
    return Settings()
