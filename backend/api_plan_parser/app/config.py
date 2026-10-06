import json
from functools import lru_cache
from typing import List, Optional, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


import os

_base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_env_file = os.path.join(_base_dir, ".env")

class Settings(BaseSettings):
    """Configuration settings for SoraPlan Floor Plan Parser Worker."""

    model_config = SettingsConfigDict(
        env_file=(_env_file, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENV: str = Field(default="development", description="Runtime environment")
    PORT: int = Field(default=8001, description="Worker listening port")
    HOST: str = Field(default="0.0.0.0", description="Worker listening host")
    PROJECT_NAME: str = Field(default="SoraPlan Plan Parser Worker", description="Worker service name")
    DEBUG: bool = Field(default=False, description="Debug mode")

    # OpenAI configuration
    OPENAI_API_KEY: str = Field(..., description="OpenAI API Key")
    OPENAI_MODEL: str = Field(default="gpt-6-sol", description="OpenAI Vision model for floor plan parsing")

    # Google Cloud / Firebase configuration
    FIREBASE_PROJECT_ID: str = Field(default="soraplan", description="Google Cloud Project ID")
    FIREBASE_CREDENTIALS_PATH: Optional[str] = Field(
        default=None,
        description="Path to service account JSON key file",
    )
    GCS_BUCKET_NAME: str = Field(default="soraplan-assest-dev", description="Cloud Storage bucket name")

    # CORS configuration
    CORS_ORIGINS: Union[List[str], str] = Field(
        default=["http://localhost:3000", "http://localhost:5173", "*"],
        description="Allowed CORS origins",
    )

    @field_validator("CORS_ORIGINS", mode="before")
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
        return ["*"]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
