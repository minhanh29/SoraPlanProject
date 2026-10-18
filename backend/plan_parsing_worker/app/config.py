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

    # Gemini (floor plan parsing). Vertex AI with the service account by default.
    GEMINI_PARSER_MODEL: str = Field(default="gemini-4-argon", description="Gemini vision model for floor plan parsing")
    GEMINI_LOCATION: str = Field(default="global", description="Vertex AI location for Gemini")
    PLAN_REVIEW_ROUNDS: int = Field(default=2, description="Gemini self-review rounds after the parse (0 disables)")

    # OpenAI configuration (furniture background removal)
    OPENAI_API_KEY: str = Field(..., description="OpenAI API Key")
    OPENAI_IMAGE_MODEL: str = Field(default="gpt-image-1.5", description="OpenAI image model for furniture background removal (Images edit)")

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
