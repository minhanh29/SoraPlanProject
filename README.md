# SoraPlan

Turn a floor-plan sketch into a real-scale 3D home you can walk through and furnish.

Upload a sketch, photo, or PDF of a floor plan. Gemini reads the walls, doors, rooms, and dimension labels and
builds a scene measured in meters. Pick a style to get an AI-furnished photoreal preview, then enter the 3D
world: orbit, walk through, and move or resize furniture with live measurements and fit checks. Use the
preset catalog or upload photos of your own furniture, which are converted to 3D with Meshy.

Built for the Google AI builder hackathon.

**Authors:** Minh Anh Nguyen, Trung Tin Phan

## Stack

- **Web:** Next.js, React Three Fiber, Firebase Auth / App Hosting
- **Backend:** FastAPI (`api`, `ai-worker`), Node (`asset-worker`) on Cloud Run, Cloud Tasks, Firestore, Cloud Storage + CDN
- **AI:** Gemini 3.1 Pro / Flash, Nano Banana Pro, Gemini Live, Gemini Embeddings, Google ADK
- **3D generation:** Meshy (primary), Tripo (fallback)

## Current state

The design docs (`GEMINI.md`, `docs/`) describe the target architecture. What runs today is the chat-first
app from [`docs/10-chat-refactor-plan.md`](docs/10-chat-refactor-plan.md):

- **Web:** `web/`, Vite + React + TypeScript, React Three Fiber, Firebase Auth + Firestore listeners, on
  Firebase Hosting. One conversation per project; Gemini guides the flow (crop → plan review → style →
  missing objects → isometric 3D) and edits the scene through tools.
- **API:** `backend/api`, FastAPI on Cloud Run. Conversations, Gemini orchestrator (Vertex AI), asset
  mapping, scene builder and scene ops, asset library with server-side Meshy polling (Cloud Tasks).
- **Plan parsing worker:** `backend/plan_parsing_worker`, private FastAPI on Cloud Run, invoked by Cloud Tasks.
  Parses the cropped plan with Gemini 4 Argon (Vertex AI) and posts the result into the conversation.
- **Preset furniture catalog:** `gs://soraplan-catalog/assets/{Industrial,Japandi}/` (originals) and
  `assets-web/` (meshopt + WebP, ~0.5 MB each). 3D files are never committed to git.

## Repository layout

```
web/                          Chat-first web app (Vite, React, R3F)
backend/api/                  REST API (Cloud Run, public)
backend/plan_parsing_worker/  Floor-plan parser (Cloud Run, private)
deploy/                       setup.sh, upload_catalog.sh, deploy.sh
scripts/                      catalog optimize/measure, asset migration, crop examples
firestore.rules               read-only rules for the browser (all writes go through the API)
docs/                         Target design and research
```

## Local development

```bash
# API (port 8000)
cd backend/api && cp .env.example .env   # fill in keys
python -m venv .venv && .venv/bin/pip install -r requirements.txt
gcloud auth application-default login    # Gemini through Vertex AI
.venv/bin/uvicorn app.main:app --reload --port 8000

# Worker (port 8001)
cd backend/plan_parsing_worker && cp .env.example .env
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8001

# Web (port 5173)
cd web && cp .env.example .env.local     # VITE_FIREBASE_API_KEY = FIREBASE_WEB_API_KEY
npm install && npm run dev
```

Credentials live only in the gitignored `.env` files and `backend/api/.secrets/`. On Cloud Run they come
from Secret Manager and the service accounts' own identity.

## Deploy (project `soraplan`, gcloud configuration `trungtin`)

```bash
deploy/setup.sh                       # once: APIs, service accounts, IAM, secrets, queues, buckets
scripts/optimize_catalog.sh           # once per catalog change: web-optimized GLBs
deploy/upload_catalog.sh              # sync assets/ and catalog/out/assets-web to gs://soraplan-catalog
deploy/deploy.sh all                  # worker -> api -> Firestore rules -> web
backend/api/.venv/bin/python scripts/migrate_assets.py --apply   # once: seed assets/ in Firestore
```

`firebase login` is needed once for the rules and Hosting steps.

## Documentation

- [`GEMINI.md`](GEMINI.md): high-level target design and repo conventions
- [`docs/`](docs): research, architecture, data model, AI pipeline, backend, frontend, 3D assets, infra, roadmap
