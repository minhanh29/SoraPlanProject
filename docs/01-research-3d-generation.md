# 01 — Research: Image → 3D generation (Meshy vs Tripo vs img2threejs)

Status: **Decided** — Meshy primary, Tripo fallback, img2threejs optional/offline only.
Research date: 2026-10-02. Re-check provider docs before implementation; APIs and model names move fast.

---

## 1. What we need from an image→3D provider

| # | Requirement | Why |
|---|---|---|
| R1 | **Visually beautiful** textured mesh, PBR materials | Explicit product requirement; the 3D world is the selling point |
| R2 | Good results for **furniture** (hard-surface + soft fabric) | Our domain |
| R3 | **Web-friendly** output: GLB, controllable polycount, 2k textures | Must run smoothly in the browser with 20–60 objects |
| R4 | Scale/orientation helpers (origin at bottom, auto-size) | Our differentiator is real-world scale |
| R5 | Better hidden sides (multi-image input) | Users usually have one product photo |
| R6 | REST API, async tasks, webhooks/polling, reasonable rate limits | Server-side pipeline at scale |
| R7 | Cost per object ≲ $0.50 | Hackathon budget, then unit economics |
| R8 | Retexture an existing mesh | "Same sofa but in green velvet" without regenerating geometry |

## 2. Candidates

### 2.1 Meshy (meshy.ai) — **chosen as primary**

API (`POST /openapi/v1/image-to-3d`), relevant parameters:

| Parameter | Use in SoraPlan |
|---|---|
| `ai_model`: `meshy-6`, `meshy-7.1`, `latest` | Pin a version in `config/models.yaml` (don't use `latest` in prod — reproducibility) |
| `image_url` (URL or data URI) | Signed GCS URL of the cleaned product cutout |
| `should_texture: true`, `enable_pbr: true` | Base color + metallic + roughness + normal maps → realistic under our HDRI lighting |
| `texture_resolution: "2k"` | 2k is the sweet spot for web; 4k only for "hero" items |
| `should_remesh: true`, `topology: "triangle"`, `target_polycount: 30000` | Browser budget (see §5) |
| `remove_lighting: true` | Removes baked shadows/highlights from the photo → consistent look under our lights |
| `image_enhancement: true` | Cleaner input |
| `auto_size: true`, `origin_at: "bottom"` | Approximate real size + correct pivot. We still rescale to the confirmed dimensions. |
| `target_formats: ["glb", "usdz"]` | GLB for web, USDZ for future iOS AR |
| `texture_prompt` / `texture_image_url` | Steer material (e.g. "light oak, matte") |
| `multi_view_thumbnails: true` | Free front/right/back/left thumbnails → catalog cards & QA |

Related endpoints: **Multi-Image-to-3D** (R5), **Retexture** (R8), **Remesh**. Task statuses
`PENDING / IN_PROGRESS / SUCCEEDED / FAILED / CANCELED` with `progress` 0–100 → we mirror into Firestore.

Pricing (public docs, verify): ~20 credits untextured / ~30 credits textured per image-to-3D task;
subscriptions from ~$10–20/month; test-mode API keys exist for development.

Quality: in blind tests by professional 3D artists, **Meshy-6 was preferred ~64% of the time over Tripo 3.1**;
richer texture control; generation ~60 s.

### 2.2 Tripo (tripo3d.ai) — **fallback adapter**

- Strengths: fast (~10 s "smart mesh"/draft), cheap ($0.01/credit, generous free credits), multi-view input,
  quad topology, auto-rigging, stylization (not needed by us), up to 2M polys in ultra mode.
- Weaknesses vs our needs: slightly lower texture quality in blind tests; docs less polished; v3 ~100 s.
- Use: (a) automatic failover when Meshy is down/rate-limited; (b) optional "quick draft" mode so the user
  sees a rough 3D object in ~10 s while the Meshy high-quality job finishes (progressive replacement).

### 2.3 img2threejs (github.com/img2threejs/img2threejs) — **not a runtime component**

What it actually is (from its README):
- An **agent skill** for Claude Code / Codex / OpenCode, invoked like `/img2threejs Rebuild this object…`.
- Reconstructs an object from one image as **procedural Three.js TypeScript** (`createXModel()` returning a
  `THREE.Group`) + an `ObjectSculptSpec` JSON, through staged passes
  (blockout → structural → form → material → surface → lighting → interaction → optimization) with vision review.
- Python stdlib scripts + host LLM; Apache-2.0; strong on hard-surface objects; explicitly "not photoreal".
- It does **not** call Meshy/Tripo and is **not** a viewer for GLB files.

Fit assessment:

| Criterion | img2threejs |
|---|---|
| Runtime per-user generation | ❌ agent-driven, minutes per object, needs a coding-agent host (non-Google LLM) |
| Photoreal beauty (R1) | ⚠️ stylized, primitives + shaders |
| Tiny payload, crisp at any zoom | ✅ code, no textures |
| **Parametric resize without distortion** | ✅ procedural geometry can be rebuilt at any width/height |
| Google hackathon story | ❌ depends on Claude/Codex host |

**Decision:** keep the runtime on standard **Three.js + React Three Fiber + GLTFLoader**. Optionally, during
development, use img2threejs (or hand-written code) to author a small set of **parametric catalog items**
(`kind: "parametric"` in the catalog — see `07-3d-asset-pipeline.md §4`): kitchen cabinets, wardrobes,
bookshelves, countertops, tables, door & window frames. These benefit from distortion-free resizing,
which matters for our "fit real measurements" pitch. Everything organic (sofas, armchairs, beds with
soft bedding, lamps, plants, rugs, decor) uses Meshy GLBs.

### 2.4 Others considered (not chosen)

| Provider | Note |
|---|---|
| Rodin (Hyper3D) | Highest quality, but premium price (~$120/month minimum) — revisit for "hero" assets |
| Hunyuan3D (Tencent) | Good, multi-view; self-hostable on GPUs (could run on GKE/Cloud Run GPU later to cut cost) |
| TRELLIS.2 (Microsoft) | Open model, PBR; self-host option on Cloud Run GPU (L4) for scale phase |

## 3. Why not "image only" or "3D from the whole room image"?

Room-level image→3D (or Gaussian splats from a generated image) gives a pretty but **non-metric, non-editable**
blob — exactly the problem we're solving. We generate **architecture procedurally** from the parsed plan (exact
meters) and **furniture as separate objects** scaled to real dimensions.

## 4. Pipeline for a user-uploaded furniture photo (summary — details in doc 07)

```
photo ──► Gemini Flash: classify + estimate dims (W×D×H, m) + detect if multiple items
      ──► Nano Banana Pro: isolate product, white background, front-3/4 view, remove clutter
      ──► Nano Banana Pro: generate side + back views (consistent multi-view)          [optional, improves R5]
      ──► Meshy Multi-Image-to-3D (or Image-to-3D) PBR, 30k tris, origin bottom
      ──► asset-worker: normalize (axis, pivot, scale to dims), compress (meshopt + KTX2/WebP), thumbnails
      ──► Gemini Flash (vision QA on 4 rendered thumbnails vs source photo): pass / retry
      ──► user confirms dimensions (prefilled) ──► available in library
```

## 5. Web performance budget (drives provider settings)

| Item | Budget |
|---|---|
| Triangles per furniture item | ≤ 30k typical, ≤ 50k hero |
| Total scene triangles | ≤ 1.5M (desktop), ≤ 600k (mobile → use LOD1) |
| Texture size | 2k base, 1k for LOD1 / mobile; KTX2 (UASTC normal, ETC1S color) or WebP |
| GLB size | ≤ 5 MB per item after compression |
| Draw calls | ≤ 300 (merge architecture meshes by material) |

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Meshy outage / rate limit | `ThreeDProvider` interface, Tripo failover, Cloud Tasks rate limiting, retries w/ backoff |
| Wrong proportions from single photo | Dimensions are **user-confirmed** and enforced by normalization; multi-view input |
| Bad cutouts (busy showroom photo) | Gemini segmentation step + user "pick the object" bounding box |
| Cost blowup | Content hash cache; per-user quota; draft (Tripo) before HQ (Meshy) only on demand |
| Model/API churn | Pin model versions; contract tests against recorded fixtures |

## Sources
- Meshy Image-to-3D API: https://docs.meshy.ai/en/api/image-to-3d
- img2threejs: https://github.com/img2threejs/img2threejs
- Meshy vs Tripo comparisons: https://www.neural4d.com/features/neural4d-vs-tripo-vs-meshy-vs-rodin ,
  https://www.rapiddirect.com/blog/meshy-vs-tripo/ , https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026
- Gemini models: https://ai.google.dev/gemini-api/docs/models , image generation: https://ai.google.dev/gemini-api/docs/image-generation
