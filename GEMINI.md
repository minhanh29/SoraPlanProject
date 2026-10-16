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
| [10-chat-refactor-plan.md](docs/10-chat-refactor-plan.md) | Everyone | Chat-first refactor: what runs today (§9) |

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

The chat-first app from [`docs/10-chat-refactor-plan.md`](docs/10-chat-refactor-plan.md): one conversation per
project, Gemini as the guide, a canvas beside the chat for crop, plan review, mapping and 3D.
Differences from the target design that matter when you change code:

| Target (§4–6) | Today |
|---|---|
| Next.js + R3F in `apps/web` | Vite + React + TS + R3F in `web/` (static SPA on Firebase Hosting) |
| `services/api`, `ai-worker`, `asset-worker` | `backend/api` and `backend/plan_parsing_worker` (both FastAPI, Python 3.12) |
| Gemini 3.1 Pro plan parsing | OpenAI Responses API (`OPENAI_MODEL`) on the user's crop, one pass (decision D4) |
| Meters everywhere | Parsed `FloorPlan` is in plan units (`ft` default); the scene builder converts to meters (§9.3) |
| Full SceneGraph + SceneOps | v1 subset: one level, walls, openings, rooms (floor color), items; ops `item.*`, `surface.material` |
| Gemini ADK agents | `orchestrator.py`: one Gemini Flash chat (Vertex AI) with function calling over `tools.py` |
| Catalog via GCS + CDN | Public bucket `gs://soraplan-catalog` (`assets/` originals, `assets-web/` optimized), no CDN |

### 9.1 Topology

```
 Browser (web/, Firebase Hosting)
   ├─ Firebase Auth JS SDK (email/password, Google)
   ├─ Firestore onSnapshot, read-only rules: conversations(+messages), projects, scenes, assets, jobs
   └─ REST + Firebase ID token ─► Cloud Run: soraplan-api (public)
                                    ├─ Workflow (stages) + Orchestrator ─► Gemini on Vertex AI (function calling)
                                    ├─ AssetMapper / SceneBuilder / SceneOps (deterministic)
                                    ├─ Cloud Tasks plan-parsing ─► soraplan-plan-parsing-worker (private)
                                    │                               └─ writes jobs/*, projects/*.floorPlan and
                                    │                                  plan_ready / plan_failed chat messages
                                    └─ Cloud Tasks meshy-poll ─► POST /internal/assets/{id}/poll (OIDC-verified)
 Storage: gs://soraplan-assest-dev (uploads, crops, user GLBs) · gs://soraplan-catalog (assets/, assets-web/)
```

- **AI proposes, deterministic code applies.** Gemini never writes Firestore; it calls tools (`tools.py`) that
  check the stage, validate args and apply. UI buttons call the same handlers (`POST /conversations/{id}/actions`).
- Destructive tools (`remove_item`, `restart_crop`, `edit_plan`, `select_style` after 3D) run only when the
  user's latest message is an explicit yes; otherwise the tool returns `NEEDS_CONFIRMATION` and Gemini asks.
- Predefined chat copy lives only in `web/src/chat/messageTemplates.ts`; the backend writes `kind` + `payload`.
- The worker has **no public access**; only the API's SA and the Cloud Tasks invoker SA can call it.
  A parse job with no update for `JOB_STALE_SECONDS` (900) is failed by `GET /v1/jobs/{id}` and the chat is reset.
- Meshy progress is polled server-side (queue `meshy-poll`, every 15 s, max 40 tries); locally a thread polls.
  When a model for a plan box is ready, its mapping is refit and the 3D placeholder resized.
- 3D edits are op batches with `baseVersion` (409 on conflict); each batch stores its inverse, and the
  undo/redo stacks on `scenes/{id}` are shared by UI and AI edits.

### 9.2 Layout

```
web/                          src/{lib,hooks,layout,chat,canvas/{PlanEditor,Scene3D},assets,three}, public/config.js
backend/api/                  app/{routers,services,models,data}, tests/ (pytest, in-memory fakes), evals/
backend/plan_parsing_worker/  app/{routers,services,models}, Dockerfile
scripts/                      optimize_catalog.sh, catalog/measure.mjs, migrate_assets.py, make_crop_examples.py
deploy/                       config.sh, setup.sh, upload_catalog.sh, deploy.sh
firebase.json, firestore.rules, firestore.indexes.json
docs/                         target design; 10-chat-refactor-plan.md = what was built
```

### 9.3 Units, scale and the catalog

- Plan → scene: `k = 0.3048` for `ft`, `1` for `m`, `10 / max(width, height)` for `normalized`;
  `X = x·k`, `Z = y·k`, `rotationY = -deg2rad(rotation) + rotationOffset`. Same rule in
  `backend/api/app/services/geometry.py` and `web/src/lib/units.ts`.
- Meshy scales every model so its longest side is ~1.9 units: catalog `dims` are **proportions**, not meters.
  The mapper fits each model uniformly into its plan box (no distortion) and picks a 90° turn so the long
  sides match and the back faces the nearest wall. Users can rescale per box during mapping or in 3D.
- Logical paths `assets/{Style}/{file}` and `assets-web/{Style}/{file}` map to
  `https://storage.googleapis.com/soraplan-catalog/...`. `assets/{id}` docs store ready-to-use URLs;
  `backend/api/app/data/system_assets.json` is the bundled fallback until Firestore is seeded.
- The local `assets/` folder (gitignored) is only the upload source for `deploy/upload_catalog.sh`.

### 9.4 Signed URLs

On Cloud Run there is no key file, so `StorageService` signs through the IAM `signBlob` API as the API's
own service account. That needs `roles/iam.serviceAccountTokenCreator` on itself (granted by `setup.sh`)
and a **`cloud-platform`-scoped** token. Outside `development`/`testing`, signing failures raise.
User asset URLs are signed for 7 days and re-signed by `GET /v1/assets?scope=mine` when < 1 day is left;
plan images are signed on demand by `GET /v1/projects/{id}/files`.

### 9.5 Configuration and credentials

| Where | API (`backend/api`) | Worker (`backend/plan_parsing_worker`) |
|---|---|---|
| Local | `.env` (copy `.env.example`), key at `.secrets/serviceAccountKey.json`, `gcloud auth application-default login` for Gemini | `.env`, reuses `../api/.secrets/serviceAccountKey.json` |
| Cloud Run env vars | `ENV`, `FIREBASE_PROJECT_ID`, `GCS_BUCKET_NAME`, `CATALOG_BUCKET_NAME`, `PLAN_PARSER_WORKER_URL`, `CLOUD_TASKS_QUEUE`, `TASKS_INVOKER_SA`, `WORKER_REQUIRES_AUTH=true`, `CORS_ORIGINS`, `ADMIN_UIDS`, `MESHY_POLL_QUEUE`, `API_PUBLIC_URL`, `GEMINI_CHAT_MODEL`, `GEMINI_LOCATION` | `ENV`, `FIREBASE_PROJECT_ID`, `GCS_BUCKET_NAME`, `OPENAI_MODEL` |
| Secret Manager | `meshy-api-key` → `MESHY_API_KEY`; `firebase-web-api-key` (written into the web build's `config.js`) | `openai-api-key` → `OPENAI_API_KEY` |
| Web | `web/.env.local`: `VITE_FIREBASE_API_KEY` (local); `dist/config.js` generated by `deploy.sh` | — |

- Gemini uses Vertex AI with the API service account (`roles/aiplatform.user`); `GEMINI_API_KEY` is a local-only
  alternative. Model ids are env values, never hard-coded in code paths.
- `ADMIN_UIDS` (comma-separated) is the only source of admin rights; the web app trusts the API's `role`.
- `CORS_ORIGINS` is an explicit list, never `*` (the API allows credentials).
- `.dockerignore` / `.gcloudignore` keep `.env`, `.secrets/` and tests out of images.

### 9.6 Local development

```bash
cd backend/api && cp .env.example .env && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000          # API
.venv/bin/python -m pytest -q tests                            # 117 tests, fully mocked
.venv/bin/python -m evals.run_chat_tools                       # Gemini tool-choice eval (real model)

cd backend/plan_parsing_worker && cp .env.example .env && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8001          # worker

cd web && cp .env.example .env.local && npm install
npm run dev                                                    # http://localhost:5173
npm test && npm run typecheck
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
| Cloud Tasks | `meshy-poll` | API → `/internal/assets/{id}/poll` with OIDC token; max 5 attempts |
| Bucket | `soraplan-assest-dev` | private user uploads, crops, user GLBs; CORS for Hosting + localhost |
| Bucket | `soraplan-catalog` | public read (`allUsers` objectViewer), CORS `*` GET; API SA objectAdmin (promotions) |
| Firestore | rules + indexes | `firestore.rules` (read-only for browsers), `firestore.indexes.json` |
| Service account | `soraplan-api@` | Firestore, Firebase Auth admin, Vertex AI user, uploads objectAdmin, Tasks enqueuer, signs as itself |
| Service account | `soraplan-worker@` | Firestore, uploads objectViewer, OpenAI secret |
| Service account | `soraplan-tasks-invoker@` | `run.invoker` on the worker; identity in Cloud Tasks OIDC tokens (both queues) |
| Hosting | `https://soraplan.web.app` | serves `web/dist` (SPA rewrite to `index.html`) |

### 10.2 First-time setup

```bash
deploy/setup.sh            # idempotent: APIs, service accounts, IAM, secrets, queues, buckets, CORS
scripts/optimize_catalog.sh  # meshopt + WebP copies of the catalog in catalog/out/assets-web
deploy/upload_catalog.sh   # sync assets/ and catalog/out/assets-web to gs://soraplan-catalog (DRY_RUN=1 to preview)
firebase login             # once; the Firebase CLI does not use gcloud credentials
deploy/deploy.sh all       # worker → api → rules → web (order matters: api needs the worker URL)
backend/api/.venv/bin/python scripts/migrate_assets.py --apply   # seed assets/ (dry run without --apply)
```

`setup.sh` reads secret values from `backend/api/.env` (`FIREBASE_WEB_API_KEY`, `MESHY_API_KEY`) and
`backend/plan_parsing_worker/.env` (`OPENAI_API_KEY`). Re-running it after changing a key adds a new secret
version; redeploy the service to pick it up. The first API deploy sets `API_PUBLIC_URL` to its own URL.

### 10.3 Updating

```bash
deploy/deploy.sh worker     # backend/plan_parsing_worker changed
deploy/deploy.sh api        # backend/api changed
deploy/deploy.sh rules      # firestore.rules / firestore.indexes.json changed
deploy/deploy.sh frontend   # web/ changed (npm ci && npm run build, writes dist/config.js)
deploy/upload_catalog.sh    # catalog models added or changed (uploads only the diff)
```

Cloud Run deploys use `--source` (Cloud Build builds each service's Dockerfile). Each deploy creates a new
revision; roll back with
`gcloud --configuration=trungtin run services update-traffic soraplan-api --region=asia-southeast1 --to-revisions=<REV>=100`.

### 10.4 Deployment log (what is live — update this after every deploy)

**2026-10-17 — chat-first refactor (docs/10) deployed.** Infra existed before; only the new pieces were added,
so `setup.sh` was NOT re-run. Done, in order:

| Step | Command (run from repo root) | Result |
|---|---|---|
| Vertex AI API | `gcloud ... services enable aiplatform.googleapis.com` | enabled |
| Gemini role | `gcloud ... projects add-iam-policy-binding soraplan --member=serviceAccount:soraplan-api@... --role=roles/aiplatform.user --condition=None` | granted |
| Catalog write (promotions) | `gcloud ... storage buckets add-iam-policy-binding gs://soraplan-catalog --member=serviceAccount:soraplan-api@... --role=roles/storage.objectAdmin` | granted |
| Meshy poll queue | `gcloud ... tasks queues create meshy-poll --location=asia-southeast1 --max-attempts=5 --min-backoff=15s --max-backoff=120s --max-concurrent-dispatches=10 --max-dispatches-per-second=5` | created |
| Optimized models | `gcloud ... storage rsync catalog/out/assets-web gs://soraplan-catalog/assets-web --recursive --cache-control='public, max-age=31536000, immutable' --content-type=model/gltf-binary` | 41 GLBs, 25 MB, public |
| Worker | `deploy/deploy.sh worker` | revision `soraplan-plan-parsing-worker-00002-67l` |
| API | `deploy/deploy.sh api` | revision `soraplan-api-00003-jmf`, `/health` OK |
| API fix | `deploy/deploy.sh api` | revision `soraplan-api-00004-hlh`: `app/data/*.json` was excluded by `*.json` in `.dockerignore`/`.gcloudignore` (500 on confirm_plan, seen in the browser as a CORS error); now whitelisted, and unhandled errors return a JSON 500 with CORS headers |
| Firestore | `deploy/deploy.sh rules` | rules + indexes released |
| Web | `deploy/deploy.sh frontend` | `https://soraplan.web.app` (web/dist) |
| Asset library | `cd backend/api && FIREBASE_CREDENTIALS_PATH=.secrets/serviceAccountKey.json .venv/bin/python ../../scripts/migrate_assets.py --apply` | 41 system + 2 user assets in `assets/` |

Live URLs: API `https://soraplan-api-va4xv7fowq-as.a.run.app` (= `API_PUBLIC_URL`), worker
`https://soraplan-plan-parsing-worker-va4xv7fowq-as.a.run.app` (private), web `https://soraplan.web.app`.

Open items:
- `GEMINI_CHAT_MODEL=gemini-3.8-flash` (location `global`) is **not verified** to exist on Vertex AI. If the chat
  answers "The assistant is unavailable", check API logs and redeploy with a valid id:
  `GEMINI_CHAT_MODEL=<id> deploy/deploy.sh api`. Then run `backend/api/.venv/bin/python -m evals.run_chat_tools`.
- The full upload → crop → parse → style → 3D flow has not been run end to end in production.

Notes for next time:
- **Code-only change:** `deploy/deploy.sh worker|api|rules|frontend` for the part that changed. Each Cloud Run
  deploy only adds a revision; it does not touch service accounts, secrets, buckets or queues.
- **Don't re-run `setup.sh`** unless a new API, role, queue or bucket setting is needed; add one-off `gcloud`
  commands like the table above instead.
- Run `gcloud` with `--configuration=trungtin --project=soraplan`. In the maintainer's zsh, `gc` and `g` are git
  aliases (`gc` = `git commit`), and `$VAR`-style command prefixes don't word-split; type `gcloud` in full.
- `backend/api/.dockerignore` and `.gcloudignore` exclude `*.json` (keys); new bundled data files need a `!path` exception.
  Check with `gcloud meta list-files-for-upload backend/api`.
- This machine has no Application Default Credentials; local scripts use
  `FIREBASE_CREDENTIALS_PATH=.secrets/serviceAccountKey.json` (from `backend/api`).
- Catalog models changed → `scripts/optimize_catalog.sh` then `deploy/upload_catalog.sh` (rsync uploads only diffs).
- `migrate_assets.py --apply` is safe to re-run (system docs upserted, existing user assets untouched).

### 10.5 Troubleshooting

- **Upload fails with `Anonymous caller does not have storage.objects.create`**: the API returned an
  unsigned URL. Check API logs for `signBytes` errors (§9.4).
- **Parse stuck on "Reading your floor plan…"**: check the queue (`gcloud tasks queues describe plan-parsing --location=asia-southeast1`)
  and worker logs; a 403 there means the invoker SA lost `run.invoker` (re-run `deploy/deploy.sh worker`).
  After 15 min without progress the chat resets to cropping with a "Try again" card.
- **Uploaded furniture stays at "Generating 3D"**: check `meshy-poll` tasks and `/internal/assets` logs; a 401/403
  there means `API_PUBLIC_URL` or `TASKS_INVOKER_SA` does not match the token.
- **Chat replies with "The assistant is unavailable"**: Vertex AI error; check `GEMINI_CHAT_MODEL` exists in
  `GEMINI_LOCATION` and the API SA has `roles/aiplatform.user`.
- **Empty sidebar / `Missing or insufficient permissions` in the browser console**: deploy rules and indexes
  (`deploy/deploy.sh rules`); a new composite index takes a few minutes to build.
- **Browser CORS error on the API**: add the origin to `HOSTING_ORIGINS`/`LOCAL_ORIGINS` in `deploy/config.sh`
  and redeploy the API. On a bucket: re-run `setup.sh`.
- Logs: `gcloud --configuration=trungtin logging read 'resource.labels.service_name="soraplan-api"' --limit=50 --freshness=1h`.
