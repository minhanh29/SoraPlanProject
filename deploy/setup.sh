#!/usr/bin/env bash
# One-time (idempotent) infrastructure setup for SoraPlan on Google Cloud.
#
#   deploy/setup.sh
#
# Creates: APIs, service accounts + IAM, Secret Manager secrets (from local .env files),
# the Cloud Tasks queue, the public catalog bucket, and CORS on both buckets.
# Safe to re-run: every step checks before it creates.

source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

PROJECT_NUMBER="$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# ---------------------------------------------------------------- APIs
log "Enabling APIs"
gc services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  identitytoolkit.googleapis.com \
  firebasehosting.googleapis.com \
  aiplatform.googleapis.com

# ---------------------------------------------------------------- Service accounts
ensure_sa() {
  local name="$1" display="$2"
  if ! gc iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    log "Creating service account $name"
    gc iam service-accounts create "$name" --display-name="$display"
  fi
}
ensure_sa "$API_SA_NAME" "SoraPlan API (Cloud Run)"
ensure_sa "$WORKER_SA_NAME" "SoraPlan plan parsing worker (Cloud Run)"
ensure_sa "$TASKS_SA_NAME" "SoraPlan Cloud Tasks invoker"

project_role() {
  gc projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null
}

log "Granting project roles"
project_role "$API_SA" roles/datastore.user
project_role "$API_SA" roles/firebaseauth.admin        # create users, revoke tokens
project_role "$API_SA" roles/cloudtasks.enqueuer
project_role "$API_SA" roles/aiplatform.user           # Gemini chat via Vertex AI
project_role "$WORKER_SA" roles/datastore.user
project_role "$WORKER_SA" roles/aiplatform.user        # Gemini plan parsing via Vertex AI
# Source deploys build with the default compute SA on new projects
project_role "$COMPUTE_SA" roles/run.builder

log "Granting service-account level roles"
# API signs GCS URLs through IAM signBlob as itself (no key file on Cloud Run)
gc iam service-accounts add-iam-policy-binding "$API_SA" \
  --member="serviceAccount:$API_SA" --role=roles/iam.serviceAccountTokenCreator >/dev/null
# API may create Cloud Tasks that carry an OIDC token for the invoker SA
gc iam service-accounts add-iam-policy-binding "$TASKS_SA" \
  --member="serviceAccount:$API_SA" --role=roles/iam.serviceAccountUser >/dev/null
# Cloud Tasks service agent mints that OIDC token
gc iam service-accounts add-iam-policy-binding "$TASKS_SA" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator >/dev/null 2>&1 || \
  warn "Cloud Tasks service agent not provisioned yet; re-run setup after the queue exists"

# ---------------------------------------------------------------- Buckets
log "Configuring uploads bucket gs://$UPLOADS_BUCKET"
gc storage buckets describe "gs://$UPLOADS_BUCKET" >/dev/null 2>&1 || \
  gc storage buckets create "gs://$UPLOADS_BUCKET" --location="$REGION" --uniform-bucket-level-access
gc storage buckets add-iam-policy-binding "gs://$UPLOADS_BUCKET" \
  --member="serviceAccount:$API_SA" --role=roles/storage.objectAdmin >/dev/null
gc storage buckets add-iam-policy-binding "gs://$UPLOADS_BUCKET" \
  --member="serviceAccount:$WORKER_SA" --role=roles/storage.objectViewer >/dev/null

CORS_FILE="$(mktemp)"
trap 'rm -f "$CORS_FILE"' EXIT
origins_json="$(printf '%s,%s' "$HOSTING_ORIGINS" "$LOCAL_ORIGINS" | tr ',' '\n' | sed 's/.*/"&"/' | paste -sd, -)"
cat > "$CORS_FILE" <<EOF
[{"origin": [${origins_json}], "method": ["GET", "HEAD", "PUT"], "responseHeader": ["Content-Type", "x-goog-resumable"], "maxAgeSeconds": 3600}]
EOF
gc storage buckets update "gs://$UPLOADS_BUCKET" --cors-file="$CORS_FILE" >/dev/null

log "Configuring public catalog bucket gs://$CATALOG_BUCKET"
gc storage buckets describe "gs://$CATALOG_BUCKET" >/dev/null 2>&1 || \
  gc storage buckets create "gs://$CATALOG_BUCKET" --location="$REGION" --uniform-bucket-level-access
gc storage buckets add-iam-policy-binding "gs://$CATALOG_BUCKET" \
  --member=allUsers --role=roles/storage.objectViewer >/dev/null
cat > "$CORS_FILE" <<EOF
[{"origin": ["*"], "method": ["GET", "HEAD"], "responseHeader": ["Content-Type", "Content-Length", "Range"], "maxAgeSeconds": 3600}]
EOF
gc storage buckets update "gs://$CATALOG_BUCKET" --cors-file="$CORS_FILE" >/dev/null
# Admins promote user assets to the system catalog: the API copies their GLB/image into this bucket
gc storage buckets add-iam-policy-binding "gs://$CATALOG_BUCKET" \
  --member="serviceAccount:$API_SA" --role=roles/storage.objectAdmin >/dev/null

# ---------------------------------------------------------------- Secrets
upsert_secret() {
  local name="$1" value="$2" accessor="$3"
  if [ -z "$value" ]; then
    warn "No value for secret $name (check your .env files); skipping"
    return
  fi
  if ! gc secrets describe "$name" >/dev/null 2>&1; then
    log "Creating secret $name"
    printf '%s' "$value" | gc secrets create "$name" --replication-policy=automatic --data-file=-
  elif [ "$(gc secrets versions access latest --secret="$name" 2>/dev/null || true)" != "$value" ]; then
    log "Adding new version of secret $name"
    printf '%s' "$value" | gc secrets versions add "$name" --data-file=-
  fi
  gc secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:$accessor" --role=roles/secretmanager.secretAccessor >/dev/null
}

log "Syncing secrets from $API_ENV_FILE and $WORKER_ENV_FILE"
upsert_secret "$SECRET_FIREBASE_WEB_API_KEY" "$(env_get "$API_ENV_FILE" FIREBASE_WEB_API_KEY)" "$API_SA"
upsert_secret "$SECRET_MESHY_API_KEY" "$(env_get "$API_ENV_FILE" MESHY_API_KEY)" "$API_SA"
upsert_secret "$SECRET_OPENAI_API_KEY" "$(env_get "$WORKER_ENV_FILE" OPENAI_API_KEY)" "$WORKER_SA"

# ---------------------------------------------------------------- Cloud Tasks
log "Ensuring Cloud Tasks queue $TASKS_QUEUE"
if ! gc tasks queues describe "$TASKS_QUEUE" --location="$REGION" >/dev/null 2>&1; then
  gc tasks queues create "$TASKS_QUEUE" --location="$REGION" \
    --max-attempts=3 --min-backoff=10s --max-backoff=120s \
    --max-concurrent-dispatches=5 --max-dispatches-per-second=1
fi
log "Ensuring Cloud Tasks queue $MESHY_QUEUE (Meshy status polling)"
if ! gc tasks queues describe "$MESHY_QUEUE" --location="$REGION" >/dev/null 2>&1; then
  gc tasks queues create "$MESHY_QUEUE" --location="$REGION" \
    --max-attempts=5 --min-backoff=15s --max-backoff=120s \
    --max-concurrent-dispatches=10 --max-dispatches-per-second=5
fi
# Retry the agent binding now that the queue (and its service agent) exists
gc iam service-accounts add-iam-policy-binding "$TASKS_SA" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator >/dev/null 2>&1 || true

log "Setup complete."
cat <<EOF

Next:
  deploy/upload_catalog.sh     # push assets/ to gs://$CATALOG_BUCKET
  deploy/deploy.sh all         # worker -> api -> rules -> frontend
  backend/api/.venv/bin/python scripts/migrate_assets.py --apply   # seed assets/ (catalog + old uploads)

Firebase Hosting uses the Firebase CLI's own login: run 'firebase login' once
with an account that can deploy to project '$PROJECT_ID'.
EOF
