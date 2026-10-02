# SoraPlan — GEMINI.md

> Context file for Gemini CLI / AI coding agents **and** the high-level design (HLD) for the team.
> Detailed technical designs live in [`docs/`](./docs). Read this file first, then the doc for your area.

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

## 5. High-level architecture

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
- Do not commit secrets. Local dev uses `.env.local` + Application Default Credentials.
