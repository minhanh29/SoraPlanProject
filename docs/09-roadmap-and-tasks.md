# 09 — Roadmap, Task Breakdown & Demo Script

Assumed team: **FE1** (3D world), **FE2** (plan editor, style flow, UI), **BE** (api, infra, jobs),
**AI** (ai-worker: parsing, agents, rendering), **3D** (asset-worker, catalog). Merge roles if the team is smaller —
priority order is P0 → P1 → P2.

## Milestones

| M | Goal | Exit criteria |
|---|---|---|
| **M0 — Skeleton** (day 1) | Monorepo, schema package, emulators, deploy pipeline | `hello` deployed on Cloud Run + App Hosting; SceneGraph types generated for TS & Py |
| **M1 — Plan → 3D shell** (days 2–4) | Upload sketch → parsed, scaled plan → walk through empty 3D home | 5 sample plans parse with < 5% area error after calibration |
| **M2 — Furnished world** (days 4–7) | Preset catalog, designer agent, 3D editing with real dims & warnings | Agent furnishes a 2-bed apartment with zero layout errors; drag/rotate/resize with live dims |
| **M3 — Beauty & previews** (days 6–9) | Lighting/post-fx, photo mode, grounded AI previews | Preview layout matches blockout (drift check pass ≥ 80%); 60 fps on M-series laptop |
| **M4 — Own furniture** (days 7–10) | Photo → 3D pipeline end to end | Sofa photo → ready, real-sized asset in < 4 min |
| **M5 — Wow & polish** (days 10–12) | Gemini Live architect, share link, demo hardening | Demo script runs 3× without failure; fixtures fallback ready |

## Tickets

### Shared / BE
- [ ] **P0** BE-1 Monorepo setup (pnpm workspaces + uv for Python), lint/format, pre-commit.
- [ ] **P0** BE-2 `packages/scene-schema`: JSON Schemas for SceneGraph, SceneOp, Asset, Material, Job + codegen scripts.
- [ ] **P0** BE-3 `scene-core` (Py + TS): `applyOps`, `validate`, geometry helpers, golden test vectors.
- [ ] **P0** BE-4 Terraform: project, buckets, Firestore, queues, SAs, secrets, Cloud Run services (doc 08).
- [ ] **P0** BE-5 api: auth middleware, projects CRUD, signed uploads, jobs service + Cloud Tasks enqueue.
- [ ] **P0** BE-6 api: `GET scene`, `POST ops` with transactional commit, history, snapshots.
- [ ] **P1** BE-7 Assets/materials endpoints incl. vector search (Firestore `find_nearest`).
- [ ] **P1** BE-8 Quotas, problem+json errors, rate limits.
- [ ] **P1** BE-9 Live API ephemeral token endpoint.
- [ ] **P2** BE-10 Share links (read-only token), public share route.
- [ ] **P1** BE-11 Firestore security rules + tests (emulator).

### AI (ai-worker)
- [ ] **P0** AI-1 Worker skeleton: task handler contract, progress reporting, LLM wrapper with logging & fixtures mode.
- [ ] **P0** AI-2 Plan preprocessing (opencv) + Gemini structured extraction (`plan_parse.v1`).
- [ ] **P0** AI-3 Geometry cleanup (shapely) + room polygonization + validation/repair loop.
- [ ] **P0** AI-4 Scale calibration (labels, doors, user reference) + SceneGraph builder + default materials.
- [ ] **P0** AI-5 Eval set (30 plans) + eval script + baseline report.
- [ ] **P1** AI-6 Layout solver (anchors → poses, wall snapping, clearance checks).
- [ ] **P1** AI-7 Designer agent (ADK) with tools; per-room parallel + coherence pass.
- [ ] **P1** AI-8 Render job: grounded Nano Banana prompt with blockout + references; drift check.
- [ ] **P1** AI-9 Asset-prep: metadata/dims, isolate, multi-view, embeddings.
- [ ] **P2** AI-10 Critic suggestions.
- [ ] **P2** AI-11 Vision QA endpoint for asset-worker.
- [ ] **P2** AI-12 Veo walkthrough video (stretch).

### 3D (asset-worker + catalog)
- [ ] **P0** 3D-1 Worker skeleton (Fastify, task contract), Docker image with `toktx`, gltf-transform.
- [ ] **P0** 3D-2 Normalization pipeline (axis, pivot, scale-to-dims, cleanup, meshopt, KTX2, LOD1) + fixture tests.
- [ ] **P0** 3D-3 Catalog manifest (80 items with real dims, 40 materials, 2 HDRIs) + ingest script.
- [ ] **P1** 3D-4 Meshy provider (image & multi-image, poll/webhook, download) + Tripo fallback.
- [ ] **P1** 3D-5 Headless thumbnail renderer (4 views) matching app lighting; front-detection step.
- [ ] **P1** 3D-6 Parametric models: cabinet, wardrobe, shelf, table, countertop, door, window (TS, shared with web).
- [ ] **P2** 3D-7 Retexture flow.

### FE1 (3D world)
- [ ] **P0** FE1-1 `WorldCanvas` + procedural architecture (walls w/ openings, floors, ceilings, baseboards).
- [ ] **P0** FE1-2 Item rendering: GLB loader (meshopt/KTX2), scale-to-dims, proxy boxes, LOD.
- [ ] **P0** FE1-3 Camera rigs: orbit (with wall cut-away), top-down, walk (pointer lock + collisions + mobile joystick).
- [ ] **P0** FE1-4 Selection + gizmo: move (floor drag, wall snap, grid), rotate (15° snap), resize by scaleMode.
- [ ] **P0** FE1-5 Live dimension lines + measure tool + warnings layer (collision, clearance zones, door swings).
- [ ] **P1** FE1-6 Visual quality: Environment HDRI, sun shadows, N8AO, SMAA, AgX, quality tiers.
- [ ] **P1** FE1-7 BlockoutCapture (clay + ID + depth passes).
- [ ] **P2** FE1-8 Photo mode (three-gpu-pathtracer).
- [ ] **P2** FE1-9 Instancing for repeated assets, perf profiling.

### FE2 (flows & UI)
- [ ] **P0** FE2-1 App shell, auth (anonymous + Google), project list, stepper.
- [ ] **P0** FE2-2 Scene store (zustand) + optimistic ops + commit/rebase + undo/redo + `useJob`.
- [ ] **P0** FE2-3 Plan step: upload, parse progress, overlay, 2D editor tools, calibrate tool.
- [ ] **P1** FE2-4 Style step: style cards, furnish job, preview cards (draft/final), approve.
- [ ] **P1** FE2-5 Library panel (search, categories, my items, materials, drag-to-scene), inspector (cm/in).
- [ ] **P1** FE2-6 Upload my furniture flow with stage progress + confirm-dims card.
- [ ] **P1** FE2-7 Architect bar: text chat → agent; voice via Gemini Live (`useGeminiLive`).
- [ ] **P2** FE2-8 Share page, mobile layout polish, i18n (en/vi).

## Critical path
`BE-2/3 (schema + scene-core)` → `AI-2..4 (plan parse)` + `FE1-1 (architecture)` → `3D-2/3 (catalog)` →
`FE1-2..5 (editing)` → `AI-6/7 (designer)` → `AI-8 + FE1-7 (previews)` → `3D-4 + AI-9 (own furniture)` → `FE2-7 (voice)`.

Unblock early: FE can start with a **hand-written sample SceneGraph** (`packages/scene-schema/samples/apartment_2br.json`)
and fixture GLBs before parsing/catalog are ready.

## Demo script (3 minutes)

1. (0:00) "AI room images look great — but would that sofa actually fit?" Show an AI image with impossible proportions.
2. (0:20) Upload a **hand-drawn sketch photo**. Parsing progress → plan appears over the sketch; "Scale from 3 dimension labels ✓".
3. (0:45) Choose "Japandi" + upload a photo of **my own armchair** (pipeline runs in background).
4. (1:05) Furnish → rooms fill in top-down → photoreal preview of the living room (matches layout).
5. (1:25) **Enter 3D world**: dollhouse orbit, then **walk** through the door into the living room.
6. (1:50) Drag the sofa: live dimension lines; push it too close → "⚠ walkway 72 cm < 90 cm"; resize the bed
   to 180 cm → "blocks wardrobe door" warning. *This is what image tools can't do.*
7. (2:15) My armchair arrives as a real-sized 3D model → drag it in next to the window.
8. (2:30) Voice: "Swap the floor to light oak and move the TV unit 40 centimeters left." → happens live.
9. (2:45) Photo mode → path-traced still; share link. Close on architecture slide: **Gemini 3.1 Pro, Nano Banana Pro,
   Gemini Live, Embeddings, ADK, Cloud Run, Firestore, Cloud Tasks, Firebase**.

Demo hardening: pre-generate the demo plan & armchair (cache hits), `AI_MODE=fixtures` fallback toggle,
pre-warm Cloud Run (`min-instances=1`), local copy of all GLBs on CDN.
