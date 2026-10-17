# Shared settings for deploy/*.sh. Sourced, not executed.
# Override any value from the environment, e.g. REGION=us-central1 deploy/setup.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GCLOUD_CONFIG="${GCLOUD_CONFIG:-trungtin}"
PROJECT_ID="${PROJECT_ID:-soraplan}"
# Same region as the existing uploads bucket (ASIA-SOUTHEAST1)
REGION="${REGION:-asia-southeast1}"

# Cloud Run services
API_SERVICE="${API_SERVICE:-soraplan-api}"
WORKER_SERVICE="${WORKER_SERVICE:-soraplan-plan-parsing-worker}"

# Service accounts (runtime identities)
API_SA_NAME="soraplan-api"
WORKER_SA_NAME="soraplan-worker"
TASKS_SA_NAME="soraplan-tasks-invoker"
API_SA="${API_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_SA="${WORKER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
TASKS_SA="${TASKS_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Storage
UPLOADS_BUCKET="${UPLOADS_BUCKET:-soraplan-assest-dev}"   # private: user sketches, photos, GLB cache
CATALOG_BUCKET="${CATALOG_BUCKET:-soraplan-catalog}"      # public-read: preset furniture
CATALOG_SRC="${CATALOG_SRC:-$REPO_ROOT/assets}"

# Cloud Tasks
TASKS_QUEUE="${TASKS_QUEUE:-plan-parsing}"
TASKS_QUEUE_PATH="projects/${PROJECT_ID}/locations/${REGION}/queues/${TASKS_QUEUE}"
MESHY_QUEUE="${MESHY_QUEUE:-meshy-poll}"
MESHY_QUEUE_PATH="projects/${PROJECT_ID}/locations/${REGION}/queues/${MESHY_QUEUE}"

# Gemini (chat orchestrator) through Vertex AI with the API's service account
GEMINI_CHAT_MODEL="${GEMINI_CHAT_MODEL:-gemini-3.8-flash}"
GEMINI_LOCATION="${GEMINI_LOCATION:-global}"

# Secret Manager secret names -> env var they feed
SECRET_FIREBASE_WEB_API_KEY="firebase-web-api-key"
SECRET_MESHY_API_KEY="meshy-api-key"
SECRET_OPENAI_API_KEY="openai-api-key"

# Local env files the secrets are read from during setup (gitignored)
API_ENV_FILE="${API_ENV_FILE:-$REPO_ROOT/backend/api/.env}"
WORKER_ENV_FILE="${WORKER_ENV_FILE:-$REPO_ROOT/backend/plan_parsing_worker/.env}"

# Firebase Hosting
HOSTING_ORIGINS="https://${PROJECT_ID}.web.app,https://${PROJECT_ID}.firebaseapp.com"
LOCAL_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"

gc() { gcloud --configuration="$GCLOUD_CONFIG" --project="$PROJECT_ID" --quiet "$@"; }

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Read KEY from a dotenv file without sourcing it (values may contain shell metacharacters).
env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  { grep -E "^${key}=" "$file" || true; } | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

service_url() {
  gc run services describe "$1" --region="$REGION" --format='value(status.url)' 2>/dev/null || true
}
