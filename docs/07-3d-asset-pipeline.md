# 07 — 3D Asset Pipeline (asset-worker + catalog)

Owner: 3D / BE engineer. Service: `services/asset-worker` — Node 22, TypeScript, Fastify,
`@gltf-transform/core|extensions|functions`, `meshoptimizer`, `sharp`, KTX-Software (`toktx` binary in the
Docker image), `puppeteer` (headless three.js thumbnails).

## 1. Provider abstraction

```ts
interface ThreeDProvider {
  name: "meshy" | "tripo";
  submit(req: GenerateRequest): Promise<{ providerTaskId: string }>;
  poll(taskId: string): Promise<{ status: "pending"|"running"|"succeeded"|"failed"; progress: number;
                                  glbUrl?: string; usdzUrl?: string; thumbnails?: Record<string,string>; error?: string }>;
  retexture?(req: RetextureRequest): Promise<{ providerTaskId: string }>;
}
interface GenerateRequest { images: string[] /* signed URLs, 1 = front, more = extra views */;
  quality: "draft" | "hq"; texturePrompt?: string; targetPolycount: number; estimatedHeightM?: number }
```

### Meshy mapping (HQ default)
```jsonc
// 1 image  → POST /openapi/v1/image-to-3d
// 2–4 imgs → POST /openapi/v1/multi-image-to-3d   (verify param names in docs)
{
  "image_url": "<signed url>",
  "ai_model": "meshy-6",              // pinned in config; evaluate meshy-7.1 on our eval set
  "should_texture": true,
  "enable_pbr": true,
  "texture_resolution": "2k",
  "should_remesh": true,
  "topology": "triangle",
  "target_polycount": 30000,
  "remove_lighting": true,
  "image_enhancement": true,
  "auto_size": true,
  "origin_at": "bottom",
  "target_formats": ["glb", "usdz"],
  "multi_view_thumbnails": true,
  "moderation": true,                  // user uploads only
  "texture_prompt": "<from Gemini metadata: materials description>"
}
```
Poll `GET /openapi/v1/image-to-3d/{id}` via delayed Cloud Tasks (15 s, then 30 s) or webhook. Download
`model_urls.glb` immediately (provider URLs expire) to `gs://…/raw/{assetId}/`.

### Tripo mapping (draft / failover)
`image_to_model` / `multiview_to_model` with `texture: true, pbr: true, face_limit: 30000, auto_size: true`
(verify against current Tripo docs). Draft mode is shown immediately and replaced when HQ finishes.

Failover policy: Meshy 5xx/429 × 3 or task FAILED → Tripo; record provider on asset.

## 2. Normalization (the step that guarantees real-world scale)

Input: raw GLB + confirmed/estimated `dims {w,d,h}` + `front_direction` from Gemini.

```
1. Load with gltf-transform; apply all node transforms (flatten), join meshes per material.
2. Orientation:
   a. Up axis: assume +Y (Meshy/Tripo export Y-up). Sanity check: if bbox height ≪ width & depth for a
      category that should be tall (wardrobe, lamp), try rotating -90° X and compare to estimated dims.
   b. Front: render 4 thumbnails (±X, ±Z) headless → Gemini Flash "which image shows the FRONT of the
      <category>?" → rotate so front faces +Z. (Meshy front ≈ input image view, so usually 0°; verify.)
3. Pivot: translate so bbox min.y = 0 and bbox center x,z = 0  (bottom-center origin).
4. Scale: s_axis = dims_axis / bbox_axis. If |s_x/s_y - 1| etc. ≤ 0.05 → apply uniform mean scale;
   else apply per-axis scale (the AI geometry proportions were off) and flag `proportionsAdjusted`.
   Bake scale into vertices → the GLB is now 1 unit = 1 m at real size.
5. Cleanup: weld, dedup, prune, remove degenerate tris, recompute normals only if missing.
6. Materials: ensure PBR metallic-roughness; clamp metallic for fabrics/wood (Meshy sometimes over-metallizes:
   if category ∈ {sofa, bed, rug, chair-fabric} set metallicFactor=0); name material slots from Gemini
   materials list where possible.
7. Textures: resize to ≤ 2048, convert to KTX2 (ETC1S for baseColor/ORM, UASTC for normal) via `toktx`;
   WebP fallback build for devices without KTX2 support (rare).
8. Geometry compression: `meshopt` (EXT_meshopt_compression) — smaller and faster to decode than Draco.
9. LOD1: `simplify` to 25% tris + 1k textures → model_lod1.glb.
10. Thumbnails: headless three.js with the same lighting as the app → thumb.webp (512²) + 4 views.
11. Upload to gs://…/assets/{assetId}/{hash}/, set Cache-Control immutable, update Firestore asset → "qa".
12. Vision QA (ai-worker): compare thumbnails vs source photo → "ready" | retry | "needs_review".
```

Budget enforcement: fail the job if final GLB > 8 MB or tris > 60k after simplification attempts.

## 3. Dimensions — how we get real measurements for user furniture

Priority order (stored in `dimsSource`):
1. **User-entered** (the inspector "Confirm size" dialog, prefilled) — ground truth.
2. **Read from the image** (product page screenshot / tag with "W 210 × D 95 × H 80 cm") via Gemini.
3. **Gemini estimate** from category priors + visual proportions (e.g., 3-seat sofa ≈ 2.1 × 0.95 × 0.85 m).
4. Meshy `auto_size` result (fallback only).

UX: when an asset becomes ready, a non-blocking card asks "Is this about 210 × 95 × 80 cm?" with
quick ✓ / edit. Changing dims re-scales instantly client-side (no re-generation).

## 4. Preset catalog

Target for hackathon: **~80 furniture items + ~40 materials** covering 7 styles.

| Source | How |
|---|---|
| Meshy batch generation | Use Nano Banana Pro to generate clean studio product images per catalog entry (`catalog/manifest.yaml`: name, category, style, real dims, material notes) → Meshy HQ → normalization pipeline. Real dims come from the manifest, so the catalog is metrically correct. |
| CC0 libraries | Poly Haven models (high quality, CC0) for plants/decor; Poly Haven / ambientCG for PBR materials & HDRIs |
| Parametric items | `kind: "parametric"` — TS modules in `apps/web/components/world/parametric/` (cabinet, wardrobe, shelf, countertop, table, desk, bed frame, door, window). Optionally bootstrapped with img2threejs at dev time; must expose `(dims, materials) => THREE.Group`. |

Ingest script: `catalog/scripts/ingest.ts` — reads manifest → creates assets via the same pipeline (idempotent
by content hash) → computes embeddings (via ai-worker endpoint) → writes Firestore. Run once per env.

Each catalog entry should have **2–3 size variants** for common items (sofa 2/3-seat, bed 140/160/180) so
users can swap sizes without stretching.

## 5. Retexture (material swap on furniture)

`POST /assets/{id}:retexture {prompt | materialImage}` → Meshy Retexture with the existing (normalized) GLB →
normalization steps 6–11 only (geometry unchanged) → new asset variant `parentAssetId`. Cached by
`hash(parentAsset + prompt/image)`.

## 6. Interfaces with other services

| From | To | Message |
|---|---|---|
| ai-worker (asset-prep done) | Cloud Tasks `asset-3d` | `{jobId, assetId, images[], dims, texturePrompt}` |
| asset-worker | Firestore `assets/{id}` | status/stage/progress updates |
| asset-worker | ai-worker `POST /internal/vision-qa` | `{assetId, sourceImage, thumbnails[]}` → score |
| asset-worker | Pub/Sub `asset-events` | `asset.ready` (for analytics, cache warm) |

## 7. Testing
- Fixture GLBs (good, wrong axis, wrong front, huge textures, metallic sofa) with expected outputs.
- Snapshot test of normalized bbox == requested dims (± 1 mm).
- Provider contract tests with recorded HTTP fixtures (nock); live smoke test with Meshy test-mode key in CI nightly.
