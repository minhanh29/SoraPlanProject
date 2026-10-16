import logging
import os
from typing import Any, Dict, Optional
import requests
from ..config import get_settings

logger = logging.getLogger("api.meshy")


class MeshyService:
    """Service to integrate with Meshy AI for 3D model generation from 2D images."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        settings = get_settings()
        self.api_key = api_key or settings.MESHY_API_KEY or os.environ.get("MESHY_API_KEY")
        self.base_url = (base_url or settings.MESHY_API_BASE_URL or "https://api.meshy.ai/openapi/v1").rstrip("/")

    @property
    def is_configured(self) -> bool:
        """Returns True if a valid Meshy API key is configured."""
        return bool(self.api_key and self.api_key.strip())

    def create_image_to_3d_task(
        self,
        image_url: str,
        resolution: str = "standard",
        texture_allowed: bool = True,
        enhancement_allowed: bool = True,
    ) -> str:
        """Create an asynchronous Image-to-3D generation task in Meshy.

        Uses the requested configuration:
        - Resolution: Standard
        - Texture: allowed
        - Image enhancement: allowed
        """
        if not self.is_configured:
            logger.warning("MESHY_API_KEY is not configured. Skipping 3D generation.")
            raise ValueError("MESHY_API_KEY is not configured in environment.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload: Dict[str, Any] = {
            "image_url": image_url,
            "model_type": resolution,
            "geometry_resolution": resolution,
            "should_texture": texture_allowed,
            "enable_pbr": texture_allowed,
            "image_enhancement": enhancement_allowed,
        }

        logger.info(
            "Submitting Image-to-3D task to Meshy API (%s/image-to-3d) for image_url: %s",
            self.base_url,
            image_url[:80] + "..." if len(image_url) > 80 else image_url,
        )

        response = requests.post(
            f"{self.base_url}/image-to-3d",
            headers=headers,
            json=payload,
            timeout=30,
        )

        if not response.ok:
            logger.error("Meshy API error (%s): %s", response.status_code, response.text)
            response.raise_for_status()

        data = response.json()
        task_id = data.get("result")
        if not task_id:
            raise ValueError(f"Meshy API response did not contain 'result': {data}")

        print("Task created:", task_id)
        logger.info("Task created: %s", task_id)
        return task_id

    def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """Fetch status, progress, and 3D asset links for a given Meshy task ID."""
        if not self.is_configured:
            raise ValueError("MESHY_API_KEY is not configured in environment.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
        }

        response = requests.get(
            f"{self.base_url}/image-to-3d/{task_id}",
            headers=headers,
            timeout=20,
        )

        if not response.ok:
            logger.error("Meshy task fetch error (%s): %s", response.status_code, response.text)
            response.raise_for_status()

        return response.json()
