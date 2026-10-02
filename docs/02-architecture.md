# 02 — System Architecture

## 1. Components

| Component | Tech | Responsibility | Scaling |
|---|---|---|---|
| **web** | Next.js 15 (App Router), TS, React Three Fiber, drei, zustand, Tailwind, shadcn/ui | UI, 2D plan editor, 3D editor, walk mode, local SceneOp application | Firebase App Hosting (Cloud Run under the hood) + CDN |
| **api** | Python 3.12, FastAPI, Pydantic v2 | Auth, projects, scenes, SceneOp validation/commit, signed URLs, job creation, Live API ephemeral tokens | Cloud Run, min 0/1, max 50, concurrency 80 |
| **ai-worker** | Python 3.12, `google-genai`, `google-adk`, shapely, numpy, opencv | Plan parsing, scale calibration, designer agent, critic, preview rendering, asset metadata | Cloud Run, concurrency 4–8 (I/O-bound on Gemini), max 100 |
| **asset-worker** | Node 22, TS, `@gltf-transform/*`, `sharp`, `three` (headless thumbnails via `puppeteer`) | Furniture image cleanup orchestration, Meshy/Tripo jobs, GLB normalization & compression, thumbnails | Cloud Run, concurrency 2 (CPU-heavy), 2 vCPU/4 GiB, max 30 |
| **Firestore** | Native mode | Users, projects, scenes (+ versions), assets, jobs, catalog, vector index | Serverless |
| **Cloud Storage** | Buckets `uploads`, `assets`, `renders` | Raw uploads, GLBs, textures, previews | + Cloud CDN for `assets` & `renders` |
| **Cloud Tasks** | Queues per job type | Async dispatch, retries, provider rate limits | Serverless |
| **Pub/Sub** | Topic `asset-events`, `scene-events` | Fan-out (analytics, notifications, cache warmers) | Serverless |
| **Gemini API / Vertex AI** | Gemini 3.x, Nano Banana, Live, Embeddings | All AI reasoning, vision, image gen | Quota-managed |
| **Meshy / Tripo** | External REST | Image→3D | Rate-limited via queue |

> Hackathon shortcut allowed: `api` and `ai-worker` can be one Cloud Run service (different routers) at first.
> Keep the module boundary so we can split later.

## 2. Job model (everything slow is a job)

```
client ── POST /v1/projects/{p}/plan:parse ──► api
api: create jobs/{jobId} {type, status: "queued", progress: 0, input, idempotencyKey}
api: Cloud Tasks.enqueue(queue="plan-parse", url=ai-worker/tasks/plan-parse, body={jobId}, name=jobId)
api ──► 202 {jobId}
client: onSnapshot(jobs/{jobId}) → progress bar, partial results
ai-worker: handler(jobId) → updates progress/stage → writes result → status "succeeded" | "failed"
```

Job types & queues:

| Queue | Worker | Max rate | Retries | Typical latency |
|---|---|---|---|---|
| `plan-parse` | ai-worker | 5/s | 3 | 15–40 s |
| `design` (furnish rooms) | ai-worker | 5/s | 3 | 20–60 s |
| `render-preview` | ai-worker | 3/s | 3 | 10–30 s per image |
| `asset-prep` (cutout, dims, multiview) | ai-worker | 5/s | 3 | 15–40 s |
| `asset-3d` (Meshy submit + poll) | asset-worker | **Meshy RPS limit** | 5 (backoff) | 60–180 s |
| `asset-normalize` | asset-worker | 10/s | 3 | 5–20 s |

Long provider jobs (Meshy) use **submit → schedule a poll task with delay** (Cloud Tasks `schedule_time`
+15 s) rather than holding a request open. If Meshy webhooks are configured, the webhook endpoint
short-circuits polling.

## 3. Key sequences

### 3.1 Plan → Preview → 3D

```
User        web                api              ai-worker                      Gemini / Storage
 │ upload    │ PUT signed URL ─────────────────────────────────────────────────► GCS uploads/
 │──────────►│ POST plan:parse ►│ job(plan-parse) ─► parse_plan()
 │           │                  │                  ├─ preprocess (opencv deskew, contrast)
 │           │                  │                  ├─ Gemini 3.1 Pro (image → PlanJSON, schema)
 │           │                  │                  ├─ geometry cleanup (shapely: snap, merge, close rooms)
 │           │                  │                  ├─ scale calibration (dimension labels / door widths)
 │           │                  │                  └─ write scenes/{s}/versions/1 (architecture only)
 │ fix plan  │ 2D editor → SceneOps ─► api validates & commits (version 2..n)
 │ style     │ POST design ────►│ job(design) ───► Designer agent (ADK, Gemini Flash + tools)
 │           │                  │                  ├─ tools: search_catalog, get_room, place_item,
 │           │                  │                  │         check_clearance, set_material
 │           │                  │                  └─ commit SceneOps (furnished scene)
 │           │ POST render ────►│ job(render) ───► for each room: blockout image (client upload or
 │           │                  │                  headless) + refs → Nano Banana Pro → renders/
 │ approve   │                  │
 │ 3D world  │ GET scene ──────►│ (no job: 3D is built client-side from SceneGraph + CDN GLBs)
```

**Important:** the 3D world is built **in the browser** from the scene graph — no server rendering needed.
This is the cheapest and most scalable part of the system.

### 3.2 User uploads a furniture photo

```
web: PUT photo → POST /assets (source=user_photo) → job(asset-prep)
ai-worker: classify + dims + cutout + multiview → job(asset-3d)
asset-worker: Meshy multi-image-to-3d → poll → download GLB → job(asset-normalize)
asset-worker: normalize + compress + thumbnails + vision QA → assets/{a}.status = "ready"
web: onSnapshot(assets/{a}) → shows progress stages → item appears in library → "Confirm dimensions"
```

### 3.3 Live editing ("Ask the architect")

```
web ── POST /v1/live/token ──► api (mints Gemini Live ephemeral token, tool declarations = SceneOps)
web ◄──── WebSocket audio ────► Gemini Live
Gemini Live → function_call move_item{instanceId, dx: -0.5}
web: apply locally (optimistic) → POST /scenes/{s}/ops → api validates → commit / reject → toolResponse
```

## 4. Scalability & reliability

- **Stateless everywhere**; state is Firestore + GCS. Any instance can handle any request.
- **Idempotency**: job id = Cloud Tasks task name; handlers check `jobs/{id}.status` before work; provider
  calls carry our `jobId` in metadata; GLB keyed by `sha256(inputs + params)`.
- **Content-addressed asset cache**: `assets/by-hash/{sha256}` → re-uploading the same photo, or two users
  using the same preset retexture, costs nothing.
- **Backpressure**: Cloud Tasks queue rate = provider quota; per-user quotas in Firestore
  (`users/{u}.quota`) checked by api before enqueue.
- **Scene writes**: optimistic concurrency with `baseVersion` on SceneOp batches; conflicts → 409 →
  client rebases (ops are small & commutative enough for single-user editing; multi-user is v2).
- **CDN**: GLB/KTX2/renders are immutable (`Cache-Control: public, max-age=31536000, immutable`), path includes hash.
- **Graceful degradation**: if 3D asset not ready, render a **dimension-correct proxy box** with the
  thumbnail as a billboard; swap when ready. The world is always usable.
- **Failover**: `ThreeDProvider` Meshy → Tripo; Gemini 3-pro-image → 3.1-flash-image for previews.

## 5. Security

- Firebase Auth ID token verified in api (`firebase-admin`). Anonymous accounts allowed (upgrade later).
- Firestore security rules: client may **read** own projects/scenes/jobs/assets, **never write** scenes or
  jobs directly (all writes via api) → validation can't be bypassed.
- Uploads via **V4 signed URLs**, content-type + size limits (20 MB images, 50 MB PDFs).
- Provider keys in Secret Manager, mounted as env vars in workers only.
- Prompt-injection hygiene: user text is passed as data fields, tools are allow-listed SceneOps, every
  agent output passes schema + geometry validation.
- Gemini safety settings on; Meshy `moderation: true` for user uploads.

## 6. Cost model (rough, per active project)

| Item | Qty | Unit (est.) | Cost |
|---|---|---|---|
| Plan parse (Gemini Pro, 1–2 calls) | 2 | ~$0.03 | $0.06 |
| Designer agent (Flash, ~20 tool calls) | 1 | ~$0.05 | $0.05 |
| Preview renders (Nano Banana Pro) | 4 rooms × 2 iterations | ~$0.13 | ~$1.00 |
| User furniture → 3D (Meshy textured) | 3 | ~$0.30 | $0.90 |
| Cloud Run / Firestore / GCS / CDN | — | — | < $0.05 |

Main levers: use Nano Banana 2 (flash) for drafts and Pro only for "final" render; cache assets by hash;
preset catalog pre-generated once.
