# 04 — AI Pipeline (ai-worker)

Owner: AI engineer. Service: `services/ai-worker` (Python 3.12, `google-genai`, `google-adk`).

All model IDs come from `config/models.yaml`:

```yaml
plan_parser:      gemini-3.1-pro-preview     # vision + spatial reasoning, structured output
plan_verifier:    gemini-3.8-flash
designer_agent:   gemini-3.8-flash           # tool calling, fast
critic:           gemini-3.1-pro-preview
asset_metadata:   gemini-3.8-flash
image_final:      gemini-3-pro-image         # Nano Banana Pro
image_draft:      gemini-3.1-flash-image     # Nano Banana 2
live_architect:   gemini-3.8-live
embedding:        gemini-embedding-2-preview
video_walkthrough: veo-3.1-generate-preview  # stretch
```

Use **Vertex AI** endpoint in prod (quotas, VPC-SC, billing on GCP) and AI Studio key for local dev —
`google-genai` supports both via `genai.Client(vertexai=True, project=…, location=…)`.

---

## Stage A — Floor plan parsing

### A1. Pre-processing (deterministic, opencv)
1. PDF → PNG (first page, 200 DPI) with `pdf2image`; HEIC → JPEG.
2. Auto-orient (EXIF), perspective correction for phone photos (largest quadrilateral → warp).
3. Contrast normalize (CLAHE), resize so long edge = 2048 px. Keep transform matrix so we can map back.
4. Optional line detection (LSD / Hough) → candidate wall segments; passed to Gemini as **hints**
   (rendered overlay image + JSON list) — improves precision on clean CAD plans.

### A2. Gemini structured extraction
Call `plan_parser` with: the preprocessed image, optional hint overlay, and `response_schema = PlanExtraction`
(Pydantic → JSON schema), `response_mime_type = "application/json"`, thinking on (high).

```python
class PlanExtraction(BaseModel):
    image_size: tuple[int, int]
    walls: list[WallPx]            # start/end in PIXELS, thickness_px, exterior: bool
    openings: list[OpeningPx]      # type, wall_index, center_px, width_px, hinge/swing if visible
    rooms: list[RoomPx]            # name (as written), type (enum), polygon_px, label_point_px
    dimension_labels: list[DimLabel]  # text "3.60", "12'6\"", parsed_meters, start_px, end_px (the dimension line endpoints)
    fixtures: list[FixturePx]      # drawn items: bed, sofa, toilet, sink, stove, bathtub, kitchen counter… with bbox_px
    scale_bar: ScaleBar | None
    notes: str                     # ambiguities
```

Prompt (`prompts/plan_parse.v1.md`, abbreviated):

> You are an architectural draftsperson. Extract the floor plan in the image into the JSON schema.
> All coordinates are integer pixels in the given image. Walls are centerlines; include every wall segment
> between junctions; snap walls you believe are orthogonal. Openings must reference the wall they are in.
> Read every dimension annotation exactly as written and give the pixel endpoints of the dimension line it
> measures. Room polygons must follow wall centerlines. Fixtures drawn in the plan (bed, sofa, WC…) must be
> listed with bounding boxes. Do not invent rooms that are not drawn. If uncertain, include it and explain in notes.

### A3. Geometry cleanup (deterministic, shapely)
1. Snap angles within ±5° to 0/90° (unless plan is clearly angled); snap endpoints within 8 px → shared junctions.
2. Split walls at T-junctions; merge collinear overlapping segments; remove < 15 px stubs.
3. Re-derive room polygons by polygonizing the wall graph (`shapely.ops.polygonize`), then match to Gemini
   rooms by label point containment (Gemini gives names/types, geometry gives exact polygons).
4. Re-attach openings to nearest wall, clamp inside wall length.
5. Validation: every room closed, area > 1 m² after scaling, no wall self-intersections, openings don't overlap.
   Failures → `plan_verifier` repair loop (max 2 rounds) with the error list, else return with `needs_review`.

### A4. Scale calibration (pixels → meters) — critical for our pitch
Compute candidates, then pick by confidence:

| Method | How | Confidence |
|---|---|---|
| Dimension labels | For each label: `meters / pixel_length(endpoints)`; take the **median** of all; reject outliers > 10% | high if ≥ 2 consistent labels |
| Scale bar | parsed bar length | high |
| Door heuristic | median door opening px ↔ 0.85 m | medium |
| Fixture heuristic | bed width 1.6 m / WC 0.4 m / bathtub 1.7 m | low |
| User reference | user draws a line in UI and types its length | **ground truth** (always overrides) |

Output `pxPerMeter`, `scaleMethod`, `confidence`. If confidence < 0.7, UI forces the "Set a known length" step.

### A5. Build SceneGraph
Transform pixels → meters (flip Y → plan Z), center plan at origin, default heights, default materials per
room type (bathroom → tile, bedroom → oak, etc.). Fixtures from the plan become **`ItemInstance` placeholders**
(`addedBy: "parser"`, matched to a catalog asset by category + nearest dims) so the user's drawn bed stays a bed.

**Eval set**: collect 30 plans (hand sketches, CAD exports, real-estate plans) with ground truth (hand-labeled).
Metrics: wall IoU, room count accuracy, opening recall, **area error %** (target < 5% with labels).
Script: `services/ai-worker/evals/plan_parse_eval.py` — run on every prompt change.

---

## Stage B — Designer agent (furnish + materials)

Built with **Google ADK** (`LlmAgent`) on `designer_agent` model. Runs per room (parallel), then a whole-home
coherence pass.

Inputs: room geometry summary (polygon, openings with positions, wall lengths, which walls are free),
`StyleProfile` (preset style + user prompt + optional inspiration images), user's own asset library, constraints.

Tools (Python functions; each returns JSON; each mutation produces a SceneOp into a **draft** batch):

| Tool | Purpose |
|---|---|
| `search_catalog(query, category, max_dims?, style_tags?, k=8)` | Firestore vector search on `assets.embedding` (+ user's own assets ranked first) |
| `search_materials(query, category)` | Floor/wall materials |
| `get_room_layout(room_id)` | Free wall segments, door swing zones, window positions, current items |
| `place_item(asset_id, anchor, wall_id?, offset?, rotation?, dims?)` | Anchors: `against_wall`, `center`, `corner`, `facing(item_id)`, `beside(item_id, side)`, `on_top(item_id)` → **solver** converts to exact pose |
| `check_layout(room_id)` | Runs collision, clearance (walkway ≥ 0.9 m, bed side ≥ 0.6 m, door swing clear, sofa↔TV 2–3 m) → warnings |
| `set_material(target, material_id)` | Floor / wall / ceiling |
| `remove_item(item_id)` | |
| `finish(summary)` | Ends with a short rationale shown to the user |

Key idea: the **LLM chooses *what* and the *relationship*; a deterministic layout solver computes the
exact coordinates** (`app/layout/solver.py`: wall-snapping, clearance-aware rectangle packing, rotation to
face anchor). This avoids hallucinated coordinates and keeps everything physically valid.

System prompt (`prompts/designer.v1.md`, abbreviated):
> You are a senior interior architect. Furnish the room for the given style and needs, using only assets
> returned by search tools. Respect real dimensions: never place items that violate check_layout errors.
> Prefer the user's own uploaded items when relevant. Keep circulation paths ≥ 90 cm. Explain choices briefly.

Loop limit: 30 tool calls per room; must end with `check_layout` returning no `error`.

**Critic pass** (`critic` model): gets the top-down render + blockout perspective + warnings; returns a list of
suggested SceneOps with reasons ("Move the desk under the window for daylight"). Shown as **one-click
suggestions** in the UI, never auto-applied.

---

## Stage C — Image preview (grounded rendering)

Goal: a beautiful image the user can approve **whose layout matches the real scene**. Plain text-to-image
would hallucinate proportions, so we condition the image model on our own geometry.

Pipeline per room:
1. **Blockout render** of the scene from a chosen camera (default: eye height 1.6 m, from the doorway, 24 mm
   equiv.). Produced by the **web client** (it already has the scene) via `renderer.domElement.toBlob()` with
   a flat "clay" style: white walls, grey floor, furniture shown as their actual GLB in neutral clay or as
   proxy boxes. Also export a **segmentation/ID pass** (each item flat color) and a **depth pass**.
   Fallback for headless: asset-worker renders with Puppeteer + the same R3F scene component.
2. Compose the Nano Banana request (`image_final`, or `image_draft` while iterating):
   - Image 1: blockout render (layout to preserve).
   - Images 2..N: thumbnails of each furniture asset in the room (front views), material swatches,
     style inspiration images (Nano Banana Pro accepts multiple reference images).
   - Prompt (`prompts/render_room.v1.md`):
     > Photorealistic interior photograph. Keep the exact camera, room geometry, wall/door/window positions, and the
     > exact position, size and silhouette of every object from Image 1. Replace each clay object with the
     > matching product reference: [sofa → Image 2], [rug → Image 3] … Floor: light oak planks (Image 7).
     > Walls: warm white matte paint. Style: Japandi, soft morning daylight from the window on the left.
     > Do not add, remove, or resize furniture.
3. **Drift check** (cheap): `plan_verifier` model compares blockout vs output — "are all N objects present at
   the same positions?" → if fail, retry once with stronger wording / draft model. Store score in `renders/`.
4. Store in GCS `renders/`, record `sceneVersion` so UI can show "preview out of date" after edits.

Also offered: **top-down styled plan** (orthographic blockout → "architectural rendered floor plan" style).
Edits on the image are **not** a source of truth — the user edits the scene, then re-renders.

---

## Stage D — Furniture asset preparation (user photos)

`asset-prep` job (ai-worker), output feeds `asset-3d` (asset-worker, doc 07):

1. **Understand** (`asset_metadata`, structured output):
   `{category, name, description, style_tags, materials:[{slot, description}], estimated_dims:{w,d,h}, dims_confidence,
     multiple_objects: bool, bbox_px, front_direction, mount}` — if the photo contains a price tag / product
   page text with dimensions, read them (high confidence).
2. **Isolate** (`image_final`): "Extract only the [category] from this photo, full object visible, centered,
   pure white background, studio lighting, 3/4 front view, no shadows, do not alter design, color or proportions."
   If `multiple_objects`, UI asks the user to tap the object first (we pass the bbox).
3. **Multi-view** (optional, default on for sofas/chairs/beds): generate `front`, `left side`, `back` views
   with the isolated image as reference ("same exact object, orthographic-like view from the back").
   Verify consistency with `plan_verifier` (same object? yes/no) → drop inconsistent views.
4. **Embed**: `embedding` model on (isolated image + description) → `assets.embedding`.
5. Enqueue `asset-3d` with images + `estimated_dims`.

After normalization (doc 07), **vision QA**: Gemini compares the 4 rendered thumbnails with the source photo
→ `{match_score, issues[]}`; < 0.6 → retry with Meshy multi-image or Tripo; still bad → `needs_review`.

---

## Stage E — "Ask the architect" (Gemini Live, voice + text)

- api mints an **ephemeral token** for the Live API with the system instruction and tool declarations.
- Tools exposed = a curated subset of SceneOps in human terms: `move_item(item, direction, distance_m)`,
  `rotate_item(item, degrees)`, `resize_item(item, w?, d?, h?)`, `swap_item(item, query)`,
  `set_material(surface, query)`, `measure(from, to)`, `check_fit(query, room)`, `undo()`.
- Item references are resolved client-side ("the sofa", "that lamp" = currently selected / looked-at item; we send
  a compact scene summary with ids and names in the session context and on each selection change).
- Responses are voice + the change animates live in the 3D world. Text chat uses the same tools via
  `designer_agent` for users without a mic.

Example: "Will a 2-meter dining table fit here with 6 chairs?" → `check_fit` → solver tries placement →
"Yes, with 95 cm clearance on each side — want me to add it?"

---

## Stage F — Stretch features
- **Veo 3.1 walkthrough video** from the approved preview image + camera path prompt (marketing/share).
- **Style transfer from a Pinterest/IG photo**: Gemini extracts a `StyleProfile` (palette, materials, furniture types).
- **Generated seamless materials**: Nano Banana → tileable texture from a photo of a tile/wood sample; normal &
  roughness derived via simple filters in asset-worker.
- **Budget mode**: assets with prices; agent respects a budget.

---

## Validation (applies to every AI output)

1. JSON schema validation (Pydantic). On failure: 1 automatic repair retry with the error message.
2. Geometry validation (`scene_core.validate`): ids exist, polygons valid, items inside rooms, no hard collisions.
3. Ops are applied to a **copy**; only committed if validation passes. Agent sees rejections as tool errors.

## Observability for AI
Log per call: `job_id, stage, model, prompt_version, input_tokens, output_tokens, latency_ms, cost_est, outcome`
to Cloud Logging (structured) → BigQuery sink → a Looker Studio dashboard (nice demo of "AI ops" too).
