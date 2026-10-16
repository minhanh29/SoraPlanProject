# SoraPlan — GEMINI.md

> Context file for Gemini CLI / AI coding agents **and** the high-level design (HLD) for the team.
> Detailed technical designs live in [`docs/`](./docs). Read this file first, then the doc for your area.
>
> **Target vs. today.** §1–8 describe the target design. The code that actually runs is a lighter first
> cut: see **§9 What runs today** before touching code, and **§10 Deployment** to ship it.

---

## 1. Product in one paragraph

A user uploads a **floor-plan sketch** (photo of a hand drawing, PDF export, or screenshot). SoraPlan
turns it into an **accurate, real-world-scaled 3D home** that they can walk through, orbit, and edit:
move / rotate / resize furniture, swap materials, and see the result from any angle. Furniture comes
from a **curated preset catalog** or from the user's **own photos** (e.g. "the sofa I saw in a shop"),
which we convert into 3D with AI. Before the heavy 3D build, the user gets a fast **AI image preview**
of the styled room to approve the look.

### The selling point (what we must nail in the demo)

| Typical AI interior tools | SoraPlan |
|---|---|
| Generate a pretty **2D image**; proportions are hallucinated | Every object lives in a **metric scene graph** (meters). A 2.1 m sofa *is* 2.1 m. |
| Can't tell whether the bed actually fits next to the wardrobe | **Collision, clearance and walkway checks** with live dimension labels |
| One fixed camera | **Walk mode (first person)** + orbit + top-down plan, from any angle |
| Re-prompt and hope | **Direct manipulation** (gizmos, snapping) + "Ask the architect" (Gemini voice/text agent edits the scene) |

---

## 2. Core design principle: the Scene Graph is the single source of truth

Everything — the 2D plan, the AI image preview, the 3D world — is a **projection of one JSON
document** (`SceneGraph`, in **meters**, Y-up, right-handed). AI models *propose* changes to the scene
graph; deterministic code *validates* and *renders* it. This is what makes scale correct, unlike
image-only AI design tools.

```
           ┌─────────────────────────── SceneGraph (meters, JSON, versioned) ───────────────────────────┐
 sketch ──►│ walls · openings · rooms · surfaces(materials) · furniture instances(assetId, pose, dims)  │
           └───────┬───────────────────────────────┬───────────────────────────────┬───────────────────┘
                   │                               │                               │
            2D plan editor                 AI image preview                 3D world (Three.js)
         (correct the parse)     (blockout render → Nano Banana Pro)   (walls extruded procedurally,
                                  grounded on real layout              furniture GLBs scaled to real dims)
```

**Rules every developer must follow**
1. Units are **meters** everywhere in data and APIs. Convert only at the UI edge (cm / ft-in display).
2. LLM output is never trusted directly: it goes through JSON-schema validation + geometric validation
   (`docs/04-ai-pipeline.md §Validation`).
3. Architecture (walls, floors, ceilings, openings) is **generated procedurally**, never by an image-to-3D model.
4. Furniture GLBs are **normalized** on ingest: origin at bottom-center, front faces **+Z**, bbox scaled to
   real dimensions (`docs/07-3d-asset-pipeline.md`).
5. Every scene mutation is a typed **SceneOp** (`docs/03-data-model.md §SceneOps`) — the same ops are used
   by the UI, the AI agent, undo/redo, and realtime sync.

---

## 3. User flow (3 steps)

```
 ① PLAN                      ② STYLE & PREVIEW                    ③ 3D WORLD  (main selling point)
 ───────────                 ─────────────────                    ───────────────────────────────
 Upload sketch               Pick style / prompt                  Auto-built 3D home, real scale
 → Gemini parses walls,      → Designer agent picks materials     → Orbit / top-down / walk mode
   doors, windows, rooms,      + furniture (preset or user          → Drag, rotate, resize w/ live dims
   dimension labels            uploaded) and lays it out          → Collision & clearance warnings
 → Scale calibration         → Blockout render → Nano Banana Pro  → Swap materials & furniture
 → User fixes in 2D editor     photoreal preview per room         → "Ask the architect" (voice/text)
                             → User iterates, approves            → Photo mode (path-traced stills)
                                                                  → Share link / export
```

In parallel (background): user-uploaded furniture photos → cleaned up with Gemini image editing →
multi-view generation → **Meshy** image/multi-image-to-3D → normalized GLB → added to the user's library.

---

## 4. Technology decisions (summary — see `docs/01-research-3d-generation.md` for the full research)

### 4.1 Image → 3D: **Meshy (primary), Tripo (fallback adapter)**

- **Meshy-6 / meshy-7.1** wins on *visual quality* — the requirement is "3D objects must look good".
  In blind tests by professional 3D artists Meshy-6 was preferred ~64% of the time over Tripo 3.1.
- It has the API features we specifically need: `enable_pbr` (base color / metallic / roughness / normal
  maps), `texture_resolution` up to 4k, `target_polycount` + `should_remesh` (web budget),
  **`auto_size` + `origin_at: "bottom"`** (helps real-world scale), **Multi-Image-to-3D** (feed it
  Gemini-generated extra views for better back sides), **Retexture** (apply a fabric/material to a preset
  sofa), GLB + USDZ output (USDZ = free iOS AR Quick Look later).
- **Tripo** is faster (~10 s) and cheaper; keep it behind the same `ThreeDProvider` interface as a fallback
  for rate-limits/outages and for "draft quality" mode.

### 4.2 About `img2threejs`

`img2threejs` is **not a GLB viewer/runtime**. It is an *agent skill* (for Claude Code / Codex / OpenCode)
that reconstructs an object from one image as **procedural Three.js TypeScript code** (primitives +
shaders), through a multi-pass review loop. Consequences:

- ❌ Not suitable for the per-user runtime pipeline (agent-driven, minutes per object, needs a non-Google
  LLM host, stylized/procedural rather than photoreal).
- ✅ Useful **offline, at dev time**, for a small set of **parametric** catalog items (shelves, cabinets,
  tables, door/window frames) where we want *resize without distortion* — a procedural cabinet can be
  1.2 m or 2.4 m wide and still look right, while a stretched GLB sofa looks wrong.
- The runtime 3D world is built with **Three.js via React Three Fiber**, loading Meshy GLBs with
  `GLTFLoader` (+ Meshopt / KTX2). This is the standard, well-supported path.

### 4.3 Google stack (hackathon requirement: Google services + AI everywhere)

| Need | Google service |
|---|---|
| Floor-plan understanding (vision + reasoning → JSON) | **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`) structured output |
| Fast agent / tool calling / metadata | **Gemini 3.x Flash** (`gemini-3.8-flash`) |
| Photoreal room preview, product cutout, multi-view, texture swatches | **Nano Banana Pro** (`gemini-3-pro-image`), **Nano Banana 2** (`gemini-3.1-flash-image`) for drafts |
| "Ask the architect" voice editing | **Gemini Live API** (`gemini-3.8-live`) with function calling → SceneOps |
| Semantic furniture search ("mid-century walnut sideboard") | **Gemini Embedding 2** (multimodal) + **Firestore vector search** |
| Agent framework | **Google ADK** (Agent Development Kit, Python) |
| Walkthrough video (stretch) | **Veo 3.1** from preview image |
| Auth | **Firebase Auth** (Google sign-in + anonymous guest) |
| DB + realtime job progress | **Cloud Firestore** |
| File storage + CDN | **Cloud Storage** + **Cloud CDN** |
| Frontend hosting | **Firebase App Hosting** (Next.js) |
| Backend API & workers | **Cloud Run** (services + jobs), autoscaling to zero |
| Async jobs | **Cloud Tasks** (per-job queues with rate limits) + **Pub/Sub** for events |
| Secrets | **Secret Manager** (Meshy/Tripo keys) |
| Observability | Cloud Logging / Trace / Error Reporting |
| CI/CD | Cloud Build + Artifact Registry, Terraform |

Model IDs are **config values** (`config/models.yaml`), never hard-coded — preview models change.

---

## 5. High-level architecture (target; today: §9.1)

```
                         ┌───────────────────────────────────────────────┐
  Browser (Next.js +     │ Firebase App Hosting (Next.js SSR + static)   │
  React Three Fiber) ───►│                                               │
     │   ▲               └───────────────────────────────────────────────┘
     │   │ Firestore realtime listeners (job progress, scene updates)
     │   │
     │   │ REST/JSON (Firebase ID token)         WebSocket (Live API, ephemeral token)
     ▼   │                                                 │
 ┌──────────────────────────────┐                          ▼
 │ Cloud Run: api  (FastAPI)    │                Gemini Live API (voice architect)
 │  - projects, scenes, assets  │
 │  - SceneOp apply/validate    │──── enqueue ───► Cloud Tasks queues
 │  - signed upload URLs        │                    │  plan-parse │ design │ render │ asset-3d │
 └──────┬───────────┬───────────┘                    ▼
        │           │                     ┌──────────────────────────────┐   ┌──────────────────┐
        │           │                     │ Cloud Run: ai-worker (Py)    │──►│ Gemini API /     │
        │           │                     │  ADK agents: PlanParser,     │   │ Vertex AI        │
        │           │                     │  Designer, Critic, Renderer  │   └──────────────────┘
        │           │                     └──────────────────────────────┘
        │           │                     ┌──────────────────────────────┐   ┌──────────────────┐
        │           │                     │ Cloud Run: asset-worker (TS) │──►│ Meshy API        │
        │           │                     │  cutout → multiview → 3D →   │   │ (Tripo fallback) │
        │           │                     │  normalize (gltf-transform)  │   └──────────────────┘
        │           │                     └──────────────────────────────┘
        ▼           ▼                                  │
   Firestore    Cloud Storage (+CDN) ◄─────────────────┘   (uploads, GLBs, textures, renders)
```

Scalability: all compute is stateless Cloud Run that scales to zero; long AI calls are async jobs with
idempotency keys; provider rate limits are enforced by Cloud Tasks queue `max_dispatches_per_second`;
generated assets are content-addressed and cached (same photo hash ⇒ same GLB, no second Meshy bill);
static 3D assets are served from CDN with immutable cache headers.

---

## 6. Repository layout (target)

```
soraplan/
├── GEMINI.md                    # this file
├── docs/                        # detailed technical design (assign per developer)
├── apps/
│   └── web/                     # Next.js 15, TypeScript, R3F, drei, zustand, Tailwind
├── services/
│   ├── api/                     # Python 3.12, FastAPI, Cloud Run
│   ├── ai-worker/               # Python 3.12, google-genai, google-adk, shapely
│   └── asset-worker/            # Node 22, TypeScript, @gltf-transform, sharp
├── packages/
│   └── scene-schema/            # SceneGraph + SceneOp JSON Schemas → generated TS types & Pydantic models
├── catalog/                     # preset furniture & material manifests + ingest scripts
├── config/models.yaml           # model IDs, provider settings
└── infra/                       # Terraform (GCP), Cloud Build configs
```

`packages/scene-schema` is the **contract** between FE, BE and AI. Change it first, regenerate types, then code.

---

## 7. Docs index — who reads what

| Doc | Owner | Content |
|---|---|---|
| [01-research-3d-generation.md](docs/01-research-3d-generation.md) | Tech lead | Meshy vs Tripo vs img2threejs, decision record |
| [02-architecture.md](docs/02-architecture.md) | Tech lead / BE | Components, sequence diagrams, scaling, cost |
| [03-data-model.md](docs/03-data-model.md) | **Everyone** | SceneGraph, SceneOps, Firestore & Storage layout |
| [04-ai-pipeline.md](docs/04-ai-pipeline.md) | AI engineer | Plan parsing, scale calibration, designer agent, preview rendering, prompts |
| [05-backend.md](docs/05-backend.md) | BE engineer | REST API, jobs, auth, validation, errors |
| [06-frontend.md](docs/06-frontend.md) | FE engineer(s) | Pages, 2D plan editor, 3D editor, walk mode, rendering quality |
| [07-3d-asset-pipeline.md](docs/07-3d-asset-pipeline.md) | 3D / BE engineer | Meshy integration, GLB normalization, preset catalog |
| [08-infra-devops.md](docs/08-infra-devops.md) | DevOps | Terraform, CI/CD, envs, secrets, monitoring, budget |
| [09-roadmap-and-tasks.md](docs/09-roadmap-and-tasks.md) | PM / everyone | Milestones, task tickets, demo script |

---

## 8. Conventions for AI agents & developers working in this repo

- TypeScript `strict`; Python with type hints, `ruff` + `mypy`; Pydantic v2 models generated from `packages/scene-schema`.
- Never call Gemini/Meshy from the browser with a server key. Browser → our API → provider.
  (Exception: Gemini Live uses short-lived **ephemeral tokens** minted by our API.)
- All AI calls go through `services/ai-worker/app/llm/` wrappers that log prompt version, model, latency, token cost.
- Prompts live in `services/ai-worker/app/prompts/*.md` and are versioned (`plan_parse.v3.md`).
- Every job handler must be **idempotent** (keyed by `jobId`), and write progress to `jobs/{jobId}` in Firestore.
- Coordinates: meters, Y-up, floor at y=0, plan view uses (x, z). Angles in radians in data, degrees in UI.
- Keep GLBs ≤ 5 MB and ≤ 50k triangles per furniture item; textures ≤ 2k (KTX2/WebP).
- Do not commit secrets. Local dev uses each service's gitignored `.env` (see §9.5); Cloud Run uses Secret
  Manager + the service account's own identity. Never add a key file lookup or a default key value in code.
- **Never commit 3D files** (`.glb`, `.usdz`, `.fbx`, `.obj`, `.gltf` are gitignored). Preset models go to the
  catalog bucket with `deploy/upload_catalog.sh`; user models live in the uploads bucket. One 945 MB commit
  of models once bloated `.git` to 897 MB and forced a history rewrite.

---

## 9. What runs today

Implemented so far: step ① (upload + parse + 2D plan editor) and the furniture → 3D part of step ②.
Differences from the target design that matter when you change code:

| Target (§4–6) | Today |
|---|---|
| Next.js + R3F in `apps/web` | Static HTML/JS in `frontend/` (one large `app.js`, Canvas 2D editor, `<model-viewer>` for GLB review) |
| `services/api`, `ai-worker`, `asset-worker` | `backend/api` and `backend/plan_parsing_worker` (both FastAPI, Python 3.12) |
| Gemini 3.1 Pro plan parsing | OpenAI Responses API (`OPENAI_MODEL`, default `gpt-6-sol`), 2 passes: room corners, then full plan |
| Meters everywhere | Parsed `FloorPlan` defaults to `units: "ft"`, plan-space coordinates |
| Meshy behind a provider interface | `MeshyService` called directly from `ProjectService`; status advances only when the client polls |
| Catalog via GCS + CDN | Public bucket `gs://soraplan-catalog`, no CDN |

### 9.1 Topology

```
 Browser ── static site on Firebase Hosting (frontend/, config.js sets API + catalog URLs)
   │  REST + Firebase ID token                         PUT file to V4 signed URL
   ▼                                                              │
 Cloud Run: soraplan-api (public)  ── signs URLs ──► gs://soraplan-assest-dev  (private uploads, GLB cache)
   │  Firestore: users, projects, jobs                            ▲
   │  Meshy: create + poll image-to-3D                            │ download plan
   │  enqueue (OIDC token) ─► Cloud Tasks: plan-parsing ─►  Cloud Run: soraplan-plan-parsing-worker (private)
   │  proxy background removal (ID token) ─────────────────►    │  OpenAI vision → FloorPlan → Firestore
   ▼
 gs://soraplan-catalog/assets/{Industrial,Japandi}/*.{glb,usdz,png}  (public read; browser loads directly)
```

- The worker has **no public access**. Only the API's service account (direct calls with a Google ID token)
  and the Cloud Tasks invoker SA (OIDC token) can call it. The browser never calls it.
- Parse jobs: API writes `jobs/{jobId}` (`queued`) → worker advances `stage`
  (`downloading_image → detecting_room_corners → analyzing_with_ai → saving_results → completed | failed`).
  The client polls `GET /v1/jobs/{id}`. A job with no update for `JOB_STALE_SECONDS` (900) is marked failed.
- Without `CLOUD_TASKS_QUEUE` (local dev) the API dispatches to the worker from a background thread.

### 9.2 Layout

```
frontend/                     index.html, app.js, styles.css, config.js (local defaults), vendor/model-viewer
backend/api/                  app/{routers,services,models}, tests/ (pytest), Dockerfile
backend/plan_parsing_worker/  app/{routers,services,models}, Dockerfile
deploy/                       config.sh, setup.sh, upload_catalog.sh, deploy.sh
firebase.json, .firebaserc    Hosting serves build/frontend (generated by deploy.sh)
docs/                         target design
```

### 9.3 Preset catalog

- Logical path `assets/{Style}/{file}` is the identifier everywhere (Firestore `storagePath`, the embedded
  catalog in `app.js`). It maps to `https://storage.googleapis.com/soraplan-catalog/assets/{Style}/{file}`.
- Backend: `ProjectService.catalog_url()`; frontend: `resolveAssetUrl()`. Never read catalog files from disk.
- The local `assets/` folder (gitignored) is only the upload source for `deploy/upload_catalog.sh`.

### 9.4 Signed URLs

On Cloud Run there is no key file, so `StorageService` signs through the IAM `signBlob` API as the API's
own service account. That needs `roles/iam.serviceAccountTokenCreator` on itself (granted by `setup.sh`)
and a **`cloud-platform`-scoped** token (the Storage client's devstorage token is rejected with
"insufficient authentication scopes"). Outside `development`/`testing`, signing failures raise instead of
returning an unsigned URL.

### 9.5 Configuration and credentials

| Where | API (`backend/api`) | Worker (`backend/plan_parsing_worker`) |
|---|---|---|
| Local | `.env` (copy `.env.example`), key at `.secrets/serviceAccountKey.json` | `.env`, reuses `../api/.secrets/serviceAccountKey.json` |
| Cloud Run env vars | `ENV`, `FIREBASE_PROJECT_ID`, `GCS_BUCKET_NAME`, `CATALOG_BUCKET_NAME`, `PLAN_PARSER_WORKER_URL`, `CLOUD_TASKS_QUEUE`, `TASKS_INVOKER_SA`, `WORKER_REQUIRES_AUTH=true`, `CORS_ORIGINS`, `ADMIN_UIDS` | `ENV`, `FIREBASE_PROJECT_ID`, `GCS_BUCKET_NAME`, `OPENAI_MODEL` |
| Secret Manager | `firebase-web-api-key` → `FIREBASE_WEB_API_KEY`, `meshy-api-key` → `MESHY_API_KEY` | `openai-api-key` → `OPENAI_API_KEY` |

- `FIREBASE_CREDENTIALS_PATH` is for local dev only; unset means Application Default Credentials.
- `ADMIN_UIDS` (comma-separated) is the only source of admin rights; the frontend trusts the API's `role`.
- `CORS_ORIGINS` is an explicit list, never `*` (the API allows credentials).
- `.dockerignore` / `.gcloudignore` keep `.env`, `.secrets/` and tests out of images. Check with
  `gcloud meta list-files-for-upload backend/api`.

### 9.6 Local development

```bash
cd backend/api && cp .env.example .env && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000          # API
.venv/bin/python -m pytest -q tests                            # 41 tests, fully mocked

cd backend/plan_parsing_worker && cp .env.example .env && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8001          # worker

cd frontend && npx serve . -p 3000                             # http://localhost:3000
```

---

## 10. Deployment

Google Cloud project **`soraplan`**, gcloud configuration **`trungtin`**, region **`asia-southeast1`**
(same as the uploads bucket). All scripts read `deploy/config.sh`; any value there can be overridden by an
env var (e.g. `REGION=us-central1 deploy/deploy.sh api`).

### 10.1 Resources

| Resource | Name | Notes |
|---|---|---|
| Cloud Run | `soraplan-api` | public, 1 GiB, timeout 300 s, max 5 instances |
| Cloud Run | `soraplan-plan-parsing-worker` | `--no-allow-unauthenticated`, 1 GiB, timeout 600 s, concurrency 4, max 3 |
| Cloud Tasks | `plan-parsing` | max 3 attempts, 1 dispatch/s, 5 concurrent |
| Bucket | `soraplan-assest-dev` | private user uploads + cached Meshy GLBs; CORS for Hosting + localhost |
| Bucket | `soraplan-catalog` | public read (`allUsers` objectViewer), CORS `*` GET |
| Service account | `soraplan-api@` | Firestore, Firebase Auth admin, uploads objectAdmin, Tasks enqueuer, signs as itself |
| Service account | `soraplan-worker@` | Firestore, uploads objectViewer, OpenAI secret |
| Service account | `soraplan-tasks-invoker@` | `run.invoker` on the worker; identity in Cloud Tasks OIDC tokens |
| Hosting | `https://soraplan.web.app` | serves `build/frontend` |

### 10.2 First-time setup

```bash
deploy/setup.sh            # idempotent: APIs, service accounts, IAM, secrets, queue, buckets, CORS
deploy/upload_catalog.sh   # sync assets/{Industrial,Japandi} to gs://soraplan-catalog (DRY_RUN=1 to preview)
firebase login             # once; the Firebase CLI does not use gcloud credentials
deploy/deploy.sh all       # worker → api → frontend (order matters: api needs the worker URL)
```

`setup.sh` reads secret values from `backend/api/.env` (`FIREBASE_WEB_API_KEY`, `MESHY_API_KEY`) and
`backend/plan_parsing_worker/.env` (`OPENAI_API_KEY`). Re-running it after changing a key adds a new secret
version; redeploy the service to pick it up.

### 10.3 Updating

```bash
deploy/deploy.sh worker     # backend/plan_parsing_worker changed
deploy/deploy.sh api        # backend/api changed
deploy/deploy.sh frontend   # frontend/ changed (writes build/frontend/config.js with the API URL)
deploy/upload_catalog.sh    # catalog models added or changed (uploads only the diff)
```

Cloud Run deploys use `--source` (Cloud Build builds each service's Dockerfile). Each deploy creates a new
revision; roll back with
`gcloud --configuration=trungtin run services update-traffic soraplan-api --region=asia-southeast1 --to-revisions=<REV>=100`.

### 10.4 Troubleshooting

- **Upload fails with `Anonymous caller does not have storage.objects.create`**: the API returned an
  unsigned URL. Check API logs for `signBytes` errors (§9.4).
- **Parse job stuck in `queued`**: check the queue (`gcloud tasks queues describe plan-parsing --location=asia-southeast1`)
  and worker logs; a 403 there means the invoker SA lost `run.invoker` (re-run `deploy/deploy.sh worker`).
- **Browser CORS error on the API**: add the origin to `HOSTING_ORIGINS`/`LOCAL_ORIGINS` in `deploy/config.sh`
  and redeploy the API. On a bucket: re-run `setup.sh`.
- Logs: `gcloud --configuration=trungtin logging read 'resource.labels.service_name="soraplan-api"' --limit=50 --freshness=1h`.
