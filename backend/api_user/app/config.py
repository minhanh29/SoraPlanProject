import json
from functools import lru_cache
from typing import List, Optional, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings and configuration parameters."""

    model_config = SettingsConfigDict(
        env_file=".env",
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
        default="AIzaSyBsFF6vD5CIXa9STaFImL_JMDvWIVzQURc",
        description="Firebase Web API Key for Identity Toolkit",
    )
    FIREBASE_CREDENTIALS_PATH: Optional[str] = Field(
        default=None,
        description="Optional local path to Service Account JSON key",
    )

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
