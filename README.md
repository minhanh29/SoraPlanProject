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

The design docs (`GEMINI.md`, `docs/`) describe the target architecture (Next.js, R3F, Gemini). What runs
today is a lighter first cut:

- **Frontend:** static HTML/JS in `frontend/` (2D plan editor on Canvas, `<model-viewer>` for GLB review),
  hosted on Firebase Hosting.
- **API:** `backend/api`, FastAPI on Cloud Run. Auth (Firebase), projects, signed-URL uploads, Meshy jobs.
- **Plan parsing worker:** `backend/plan_parsing_worker`, private FastAPI on Cloud Run, invoked by Cloud Tasks.
  Parses sketches with OpenAI vision and writes the floor plan to Firestore.
- **Preset furniture catalog:** `gs://soraplan-catalog/assets/{Industrial,Japandi}/` (public read). 3D files are
  never committed to git.

## Repository layout

```
frontend/                     Static web app (config.js holds API + catalog URLs)
backend/api/                  REST API (Cloud Run, public)
backend/plan_parsing_worker/  Floor-plan parser (Cloud Run, private)
deploy/                       setup.sh, upload_catalog.sh, deploy.sh
docs/                         Target design and research
```

## Local development

```bash
# API (port 8000)
cd backend/api && cp .env.example .env   # fill in keys
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# Worker (port 8001)
cd backend/plan_parsing_worker && cp .env.example .env
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8001

# Frontend (port 3000)
cd frontend && npx serve . -p 3000
```

Credentials live only in the gitignored `.env` files and `backend/api/.secrets/`. On Cloud Run they come
from Secret Manager and the service accounts' own identity.

## Deploy (project `soraplan`, gcloud configuration `trungtin`)

```bash
deploy/setup.sh            # once: APIs, service accounts, IAM, secrets, Cloud Tasks queue, buckets
deploy/upload_catalog.sh   # sync local assets/ to gs://soraplan-catalog
deploy/deploy.sh all       # worker -> api -> frontend
deploy/deploy.sh api       # or one at a time: worker | api | frontend
```

`firebase login` is needed once for the Hosting step.

## Documentation

- [`GEMINI.md`](GEMINI.md): high-level target design and repo conventions
- [`docs/`](docs): research, architecture, data model, AI pipeline, backend, frontend, 3D assets, infra, roadmap
