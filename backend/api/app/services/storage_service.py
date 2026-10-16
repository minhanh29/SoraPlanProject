import datetime
import logging
from typing import Optional
from google.cloud import storage as gcloud_storage
from google.cloud.exceptions import NotFound

from ..config import get_settings

logger = logging.getLogger("api.storage")

_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
_iam_credentials = None


def _iam_signing_kwargs() -> dict:
    """Credentials for signing via the IAM signBlob API.

    The Storage client's own token is scoped to devstorage only, which IAM rejects
    ("insufficient authentication scopes"), so mint a separate cloud-platform token.
    """
    global _iam_credentials
    import google.auth
    import google.auth.transport.requests

    if _iam_credentials is None:
        _iam_credentials, _ = google.auth.default(scopes=[_CLOUD_PLATFORM_SCOPE])
    if not _iam_credentials.valid:
        # Also resolves service_account_email from the metadata server on Cloud Run
        _iam_credentials.refresh(google.auth.transport.requests.Request())
    email = getattr(_iam_credentials, "service_account_email", None)
    if not email or email == "default":
        raise RuntimeError("Cannot determine service account email for URL signing")
    return {"service_account_email": email, "access_token": _iam_credentials.token}


class StorageService:
    """Service handling Google Cloud Storage operations and V4 URL signing."""

    def __init__(
        self,
        client: Optional[gcloud_storage.Client] = None,
        bucket_name: Optional[str] = None,
    ):
        self.settings = get_settings()
        self.bucket_name = bucket_name or self.settings.GCS_BUCKET_NAME
        self._client = client

    @property
    def client(self) -> gcloud_storage.Client:
        if self._client is None:
            from ..firebase import get_storage_client
            self._client = get_storage_client()
        return self._client

    @property
    def bucket(self):
        return self.client.bucket(self.bucket_name)

    @property
    def catalog_bucket(self):
        return self.client.bucket(self.settings.CATALOG_BUCKET_NAME)

    def _signing_kwargs(self) -> dict:
        """Extra args for generate_signed_url when credentials have no private key.

        Locally a service account JSON key signs directly. On Cloud Run the runtime
        identity is a token-only credential, so signing goes through the IAM
        signBlob API (needs roles/iam.serviceAccountTokenCreator on itself).
        """
        creds = getattr(self.client, "_credentials", None)
        if creds is None or hasattr(creds, "sign_bytes"):
            return {}
        return _iam_signing_kwargs()

    def _unsigned_fallback(self, blob_path: str, error: Exception) -> str:
        """Plain object URL for local/test runs only; GCS rejects it for private buckets."""
        if self.settings.ENV not in ("development", "testing"):
            raise RuntimeError(f"Could not sign URL for {blob_path}: {error}") from error
        return f"https://storage.googleapis.com/{self.bucket_name}/{blob_path}"

    def upload_bytes(
        self,
        data: bytes,
        blob_path: str,
        content_type: str,
    ) -> dict:
        """Upload raw bytes directly to Cloud Storage."""
        logger.info(
            "Uploading %d bytes to gs://%s/%s (type: %s)",
            len(data),
            self.bucket_name,
            blob_path,
            content_type,
        )
        blob = self.bucket.blob(blob_path)
        blob.upload_from_string(data, content_type=content_type)
        return {
            "bucket": self.bucket_name,
            "blobPath": blob_path,
            "sizeBytes": len(data),
            "contentType": content_type,
            "gcsUri": f"gs://{self.bucket_name}/{blob_path}",
        }

    def generate_signed_read_url(
        self,
        blob_path: str,
        expiration_seconds: Optional[int] = None,
    ) -> str:
        """Generate a V4 signed GET URL for displaying uploaded content publicly."""
        exp_seconds = expiration_seconds or self.settings.GCS_SIGNED_URL_EXPIRATION_SECONDS
        blob = self.bucket.blob(blob_path)
        try:
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(seconds=exp_seconds),
                method="GET",
                **self._signing_kwargs(),
            )
            return signed_url
        except Exception as e:
            logger.warning(
                "Could not generate standard V4 signed read URL for %s: %s. Using fallback URL.",
                blob_path,
                e,
            )
            return self._unsigned_fallback(blob_path, e)

    def generate_signed_upload_url(
        self,
        blob_path: str,
        content_type: str,
        expiration_seconds: int = 900,
    ) -> str:
        """Generate a V4 signed PUT URL allowing client to upload directly to GCS."""
        blob = self.bucket.blob(blob_path)
        try:
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(seconds=expiration_seconds),
                method="PUT",
                content_type=content_type,
                **self._signing_kwargs(),
            )
            return signed_url
        except Exception as e:
            logger.warning(
                "Could not generate standard V4 signed upload URL for %s: %s. Using fallback URL.",
                blob_path,
                e,
            )
            return self._unsigned_fallback(blob_path, e)

    def blob_exists(self, blob_path: str) -> bool:
        """Check whether a blob exists in the bucket."""
        try:
            blob = self.bucket.blob(blob_path)
            return blob.exists()
        except NotFound:
            return False
        except Exception as e:
            logger.error("Error checking blob existence for %s: %s", blob_path, e)
            return False

    def delete_blob(self, blob_path: str) -> bool:
        """Delete blob from bucket if it exists."""
        try:
            blob = self.bucket.blob(blob_path)
            blob.delete()
            return True
        except NotFound:
            return False
        except Exception as e:
            logger.error("Error deleting blob %s: %s", blob_path, e)
            return False

    def delete_prefix(self, prefix: str) -> int:
        """Delete all blobs under a given prefix (e.g. folder)."""
        try:
            blobs = list(self.bucket.list_blobs(prefix=prefix))
            count = 0
            for blob in blobs:
                blob.delete()
                count += 1
            return count
        except Exception as e:
            logger.error("Error deleting blobs under prefix %s: %s", prefix, e)
            return 0

    def download_bytes(self, blob_path: str) -> bytes:
        return self.bucket.blob(blob_path).download_as_bytes()

    def copy_to_catalog(self, blob_path: str, catalog_path: str, content_type: str) -> str:
        """Copy a private upload into the public catalog bucket; returns its public URL."""
        data = self.download_bytes(blob_path)
        blob = self.catalog_bucket.blob(catalog_path)
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_string(data, content_type=content_type)
        return f"{self.settings.catalog_base_url}/{catalog_path}"
