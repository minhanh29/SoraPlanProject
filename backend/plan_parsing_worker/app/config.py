from functools import lru_cache
from typing import Optional
from pydantic import Field
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

@lru_cache()
def get_settings() -> Settings:
    return Settings()
