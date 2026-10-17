# 10 — Chat-first refactor: implementation plan

Status: **implemented 2026-10-17** (M0–M7; all recommended options in §0). Not yet deployed: run the steps in
`GEMINI.md` §10.2 (catalog upload, rules, migration) and the Gemini eval (`backend/api/evals`).

This plan turns SoraPlan from a dashboard of buttons into a chat-first product: one conversation per
project, Gemini as the guide, and a canvas beside the chat for the steps that need direct manipulation
(crop, plan review, style, 3D). It is written to be implemented milestone by milestone; each milestone
ends in something deployable.

Read first: `GEMINI.md` §9–10 (what runs today, deployment) and `docs/03-data-model.md` (SceneGraph).

---

## 0. Decisions this plan assumes

Approved 2026-10-16: the **recommended** option for every row. Everything below is written against it.

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| D1 | Frontend stack | **Vite + React + TypeScript**, Three.js via React Three Fiber, Firebase JS SDK | Keep vanilla JS (`app.js` is 6.7k lines of globals; chat + realtime + 3D on top is not maintainable) |
| D2 | How Gemini is called | **Vertex AI through `google-genai` (`vertexai=True`)** from the API, using the Cloud Run service account; no key | Gemini API key in Secret Manager (`GEMINI_API_KEY` already exists in the local env) |
| D3 | Chat model | **Gemini Flash** for the conversation and tool calls; model id in env `GEMINI_CHAT_MODEL` | Gemini Pro (slower, better at long explanations) |
| D4 | Floor-plan parser | **Keep the OpenAI worker** for this refactor; swap to Gemini as a separate task | Switch to Gemini now (bigger change, risk to the one step that already works) |
| D5 | Auth | **Firebase Auth JS SDK in the browser** (needed for Firestore realtime listeners); API keeps verifying ID tokens | Keep API-proxied login (cannot open Firestore listeners) |
| D6 | Realtime | **Firestore `onSnapshot` from the browser**, read-only via security rules; all writes go through the API | API polling / SSE |
| D7 | Catalog 3D files | **Compress all catalog GLBs** (meshopt + 1k WebP textures) into `assets-web/` before 3D scenes ship | Use the 10–60 MB originals (a furnished flat would download 200+ MB) |
| D8 | Promoting a user asset to system | Admin also picks **style + category** (needed for auto-mapping) | Name + flag only, as requested; promoted items then never auto-map |

---

## 1. Product flow

```
Sidebar: [+ New project] [Assets] ── history (1 conversation = 1 project) ── theme · profile

Empty chat ─► drop / pick floor plan ─► project + conversation created
   │
   ▼ stage: cropping          Chat asks for a tight crop; canvas shows the image with 4 handles
   │                          + good / bad example. "Confirm" button OR user says "done".
   ▼ stage: parsing           Predefined message "Reading your floor plan…" with live progress.
   │                          Worker finishes → predefined "Your plan is ready" message (realtime).
   ▼ stage: reviewing_plan    Canvas = current 2D plan editor + new "Add box" tool + labels.
   │                          "Looks right" button OR user says so.
   ▼ stage: choosing_style    Style cards (Industrial, Japandi) in the chat.
   │
   ▼ stage: resolving_missing Auto-mapping places catalog models; unmatched boxes are highlighted.
   │                          User can rescale any matched model to the expected proportions
   │                          (width / depth / height, ratio lock, "Fit to box").
   │                          Click a box → upload photo → Meshy → slot filled. Or "Skip".
   ▼ stage: scene_ready       3D isometric (3/4) view. Walls = boxes in the style's colors.
                              User edits by chat ("move the sofa 50 cm left") → Gemini tool calls,
                              or directly in 3D: zoom/orbit/pan, select, drag to move, rotate, scale.
                              Both paths write the same scene ops and share one undo history.
```

Gemini answers free-form questions at every stage ("why do I need to crop?") without changing stage.

Stages may go **back**: re-crop (re-parse), edit plan after style (re-map), change style (rebuild).

---

## 2. UI specification

### 2.1 Shell
- **Light theme by default**; toggle in the sidebar footer, persisted in `localStorage` (`soraplan.theme`),
  applied as `data-theme` on `<html>`. All colors are CSS tokens; no hard-coded colors in components.
- **Sidebar (left, 272 px, collapsible to 64 px icons; drawer on mobile)**
  1. Logo
  2. `+ New project` (primary) → empty chat
  3. `Assets` → assets page
  4. "Projects" list: one row per conversation, sorted by `updatedAt` desc. Row = thumbnail of the plan
     (24 px), title, relative time. Hover ⋮ → Rename, Delete (confirm in-page, no `confirm()`).
  5. Footer: theme toggle, avatar + name, sign out.
- Routes: `/` (new chat), `/p/:projectId` (conversation), `/assets/system`, `/assets/mine`, `/login`.

### 2.2 Chat view (Gemini-web style)
- **No canvas open**: messages centered, max width 760 px.
- **Canvas open** (crop, plan review, style result, 3D): split view — chat 400 px left, canvas fills the
  right; a divider is draggable (min chat 320 px). On < 900 px the canvas is a full-screen sheet with a
  "Back to chat" button.
- **Floating composer**: pill bar fixed 24 px above the bottom, max 760 px, soft shadow, translucent
  surface with backdrop blur. Contents: attach (📎, opens file picker; also accepts paste / drop), auto-growing
  textarea (1–6 lines), send button (disabled while empty or while Gemini is responding; becomes Stop).
  Enter sends, Shift+Enter newline.
- **Empty state**: centered headline "Drop your floor plan to start a new project", sub-line
  "Photo, scan or PDF of a floor plan. We'll turn it into a 3D home." and a dashed drop zone (also
  click to browse). Accept PNG, JPEG, WebP, PDF ≤ 25 MB. Drag-over state highlights the whole viewport.
  After picking a file: preview thumbnail + "Create project" button (this is the confirm step).
- **Messages**: assistant messages without bubble (text on canvas color), user messages in a tinted
  bubble right-aligned. Streaming text renders progressively with a subtle caret. Rich messages render
  as cards by `kind` (see §4.3).
- **Motion** (the "wow", kept small): composer lifts on focus; new messages fade/slide 8 px; parse progress
  uses a shimmering stage list; first 3D render animates the camera from top-down to isometric (800 ms).
  Respect `prefers-reduced-motion`.

### 2.3 Canvas panels
| Panel | Content | Primary action |
|---|---|---|
| Crop | Image with 4 draggable corner handles + edge handles (reuse `initImageCropper` logic), dimmed outside area, live size readout. Side card: "Good crop" vs "Bad crop" example images. | `Confirm crop` |
| Plan review | Ported 2D editor (walls, doors, windows, furniture, fixtures, labels, zoom/pan, undo/redo, inspector) **plus** `Add box` tool (drag a rectangle, then pick a category and type a label). Reference image overlay with opacity slider. | `Looks right` |
| Mapping (matched + missing) | Same editor, walls read-only; matched items show the catalog thumbnail inside their box, unmatched boxes pulse in amber with an "Upload" chip (opens the upload dialog prefilled with the label). **Selecting a matched item** opens an inspector with a small 3D preview of the model and scale controls (§2.4). The box outline in 2D always shows the model's real footprint after scaling. | `Skip remaining` / `Continue` |
| 3D scene | Isometric orthographic view with direct manipulation (§2.5), wall height toggle (full / cutaway 1 m), wall/floor color pickers in a small toolbar. | `Reset view` |

### 2.4 Scaling a matched object (mapping step)
- Inspector fields: **W / D / H in cm** (or ft-in when the plan is in feet), a **ratio lock** (on by
  default), a uniform **scale slider** (50–200 %), and **Fit to box** (reset to the automatic fit).
- With the lock on, changing one dimension scales all three; with it off, axes change independently and a
  "Stretched" warning appears when any axis deviates > 20 % from the model's native proportions.
- 2D handles: dragging a matched box's corner handle scales the model (uniform with the lock, free without);
  the 3D preview in the inspector updates live.
- Applies to all copies? A checkbox "Apply to all *Dining chair* boxes" when the same asset is mapped more
  than once (default on).
- Saved per component in `projects/{id}.mapping[componentId].dims` (meters), debounced 500 ms via
  `PATCH /v1/projects/{id}/mapping`. The scene builder uses these dims instead of the automatic fit.
- Gemini tool `scale_mapped_item` does the same from chat ("make the beds a bit longer").

### 2.5 Direct manipulation in the 3D scene
- **Camera**: scroll / pinch to zoom, left-drag on empty space to orbit (azimuth free, elevation clamped
  20°–80°), right-drag or two-finger drag to pan, double-click an item to focus, `Reset view` back to iso.
- **Select**: click an item → outline + floating chip (name, W×D×H, ⋮ with Replace / Delete). Click empty
  space or `Esc` to deselect.
- **Move**: drag a selected item; it slides on the floor plane (y fixed), snaps to 5 cm, shows live distance
  to the nearest wall, and turns red while overlapping another item or blocking a door (it can still be
  dropped; a warning stays on the item). Arrow keys nudge 5 cm (Shift = 50 cm).
- **Rotate**: ring handle around the selected item, snaps to 15° (Alt = free); `R` rotates +90°.
- **Scale**: corner handles on the selection box; same ratio-lock rule as §2.4.
- **Delete**: `Delete` / `Backspace` or chip menu.
- **Undo / redo**: `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`; one history shared with AI changes (both are op batches).
- Ops are applied optimistically in the client and sent on drag end (`POST /v1/projects/{id}/scene/ops`,
  `origin: "ui"`, `baseVersion`). On version conflict (AI changed the scene meanwhile) the client refetches
  and re-applies its pending op if still valid, otherwise shows "Scene changed, try again".
- Gemini sees UI edits through the scene summary on its next turn, so "put it back where it was" works.

### 2.6 Assets page
- Tabs: **System** | **Your assets**. Search box; on System also a style filter (All / Industrial / Japandi).
- **Card** (compact, grid `minmax(180px, 1fr)`): square image, name (1 line, ellipsis), created date
  ("Oct 16"), ⋮ menu top-right. Status pill only when not ready (`Generating 3D 42%`, `Failed`).
  - Click card → 3D viewer dialog (`<model-viewer>` or R3F), with name and close.
  - ⋮ → **Edit** (dialog: name; admins also see "System asset" toggle + style + category) and **Delete**
    (in-page confirm). System tab: ⋮ only for admins.
- **Your assets** has an `Upload` button → dialog: drop photo, name, category, optional "Remove
  background" (existing worker call through the API), then upload → Meshy. Card appears immediately with
  progress (realtime from Firestore).

---

## 3. Architecture changes

```
 Browser (React SPA on Firebase Hosting)
   ├─ Firebase Auth JS SDK (email/password, Google)
   ├─ Firestore onSnapshot (read-only): conversations, messages, projects, scenes, assets, jobs
   └─ REST → Cloud Run soraplan-api (all writes)
                ├─ ConversationService + Orchestrator ──► Gemini (Vertex AI, function calling)
                ├─ SceneBuilder / AssetMapper / SceneOps (deterministic)
                ├─ Cloud Tasks: plan-parsing ──► soraplan-plan-parsing-worker (private)
                │                                  └─ writes jobs/*, projects/*, and a predefined
                │                                     "plan_ready"/"plan_failed" message
                └─ Cloud Tasks: meshy-poll (new) ──► POST /internal/assets/{id}/poll (OIDC-verified)
 Storage: gs://soraplan-assest-dev (uploads, crops, user GLBs) · gs://soraplan-catalog (assets/, assets-web/)
```

Key rule kept from today: **AI proposes, deterministic code applies.** Gemini never writes Firestore
directly; it calls tools, tools validate and apply.

---

## 4. Data model (Firestore)

### 4.1 Collections

```
conversations/{conversationId}          # conversationId == projectId (1:1)
  ownerUid, projectId, title, stage, stageData{}, lastMessageAt, lastMessagePreview,
  busy: bool                            # true while Gemini or a job is working (disables composer)
  createdAt, updatedAt

conversations/{id}/messages/{messageId} # ordered by createdAt
  role: "user" | "assistant" | "system"
  kind: see 4.3
  text: string                          # markdown; may be empty for pure cards
  payload: {}                           # kind-specific
  status: "streaming" | "done" | "error"
  toolCalls?: [{ name, args, result }]  # for audit/debug, hidden in UI
  createdAt

projects/{projectId}                    # existing doc, extended
  + conversationId, style ("Industrial" | "Japandi" | null)
  + planImageOriginal { storagePath, width, height }   # as uploaded (PDF rendered to PNG page 1)
  + crop { x, y, width, height }                        # px in original image
  planImage { ... }                                     # now = the cropped image (parser input)
  floorPlan { ... }                                     # parsed, then user-edited (source of truth for 2D)
  floorPlanVersion: int

scenes/{projectId}                      # SceneGraph per docs/03-data-model.md, v1 subset (4.2)
  version, graph, updatedAt
scenes/{projectId}/ops/{batchId}        # OpBatch audit log (enables undo + "what did the AI change")

assets/{assetId}                        # NEW top-level library (replaces per-project furnitureImages)
  ownerUid | null, isSystem, name, category, style | null,
  imagePath, glbPath, glbWebPath, dims { w, d, h } | null, frontAxis: "+z",
  status: "uploaded" | "generating_3d" | "ready" | "failed", progress, meshyTaskId,
  createdAt, updatedAt

jobs/{jobId}                            # existing; + type "meshy_poll"
```

Migration: a one-off script `scripts/migrate_assets.py` copies `projects/*/furnitureImages/*` into
`assets/*` (dedupe by `storagePath`) and seeds the 41 system items from the catalog list currently embedded
in `frontend/app.js` (`EMBEDDED_SYSTEM_ASSETS`), with `glbPath = assets/{Style}/{name}.glb`.

### 4.2 SceneGraph v1 subset
Use `docs/03-data-model.md` §1 as is, restricted to: one `Level`, `walls`, `openings` (door/window gaps
only), `rooms` (floor color), `items`. Units are meters. Conversion from the parsed plan:
- `ft → m`: × 0.3048. `normalized` plans: scale so the longer side = `planWidth` from crop metadata, else 10 m.
- Plan (x, y) with y down → scene (x, z) with y up: `X = x·k`, `Z = y·k`.
- Wall height 2.7 m; thickness from plan × k, clamped to [0.08, 0.3] m.
- Item: `position` = box center at y = 0, `rotationY = -deg2rad(rotation)`, `dims.w/d` from box × k,
  `dims.h` from the asset's `dims.h` (fallback per category table, e.g. sofa 0.85, bed 0.5, wardrobe 2.0).

### 4.3 Message kinds
| kind | Who writes it | Payload | UI |
|---|---|---|---|
| `text` | user / Gemini | — | plain markdown |
| `crop_request` | template | `imageUrl, goodExampleUrl, badExampleUrl` | card + opens Crop panel |
| `parse_started` | template | `jobId` | live stage list bound to `jobs/{jobId}` |
| `plan_ready` | worker (template) | `stats {rooms, walls, items}` | card + "Review plan" opens editor |
| `plan_failed` | worker (template) | `error` | card + "Try again" / "Re-crop" |
| `style_picker` | template | `styles [{id, name, coverUrl}]` | two image cards, click to select |
| `mapping_result` | template | `matched, missing [{componentId, label, category}]` | summary + opens Missing panel |
| `scene_ready` | template | `sceneVersion` | card + opens 3D |
| `scene_change` | Gemini (after tools) | `batchId, summary` | text + `Undo` button |
| `error` | system | `code, message` | inline error with retry |

Predefined copy lives in **one place**: `frontend/src/chat/messageTemplates.ts`, keyed by `kind`
(the backend writes only `kind` + `payload`; the frontend renders the text). Gemini only writes `text`
and `scene_change`.

### 4.4 Security rules (`firestore.rules`, deployed with `firebase deploy --only firestore:rules`)
```
match /conversations/{id}             { allow read: if isOwner(resource); allow write: if false; }
match /conversations/{id}/messages/{m} { allow read: if isOwner(get(/databases/$(database)/documents/conversations/$(id))); allow write: if false; }
match /projects/{id}                  { allow read: if isOwner(resource); allow write: if false; }
match /scenes/{id}                    { allow read: if isOwner(get(/databases/$(database)/documents/projects/$(id))); allow write: if false; }
match /assets/{id}                    { allow read: if resource.data.isSystem == true || isOwner(resource); allow write: if false; }
match /jobs/{id}                      { allow read: if isOwner(resource); allow write: if false; }
// isOwner(doc) = request.auth != null && doc.data.ownerUid == request.auth.uid
```
All writes go through the API (Admin SDK bypasses rules).

---

## 5. Backend (backend/api)

### 5.1 New / changed endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/conversations` | Body `{fileName, contentType, sizeBytes}` → creates project + conversation, returns `{projectId, conversationId, signedUploadUrl}` |
| POST | `/v1/conversations/{id}/upload-complete` | Verifies blob, renders PDF page 1 to PNG, stores `planImageOriginal`, writes `crop_request`, stage → `cropping` |
| POST | `/v1/conversations/{id}/messages` | Body `{text}` → stores user message, runs Orchestrator, streams Gemini reply into a message doc |
| POST | `/v1/conversations/{id}/actions` | Body `{type, args}` for UI buttons (`confirm_crop`, `confirm_plan`, `select_style`, `skip_missing`, `continue`). **Same handlers as Gemini tools.** |
| PATCH | `/v1/conversations/{id}` | Rename (also renames project) |
| DELETE | `/v1/conversations/{id}` | Deletes conversation, messages, project, scene, project blobs |
| PUT | `/v1/projects/{id}/plan` | Saves edited `floorPlan` (bumps `floorPlanVersion`). **Today edits are never saved; this fixes it.** |
| PATCH | `/v1/projects/{id}/mapping` | Body `{componentId, dims, applyToSameAsset}` — scale a matched model during the mapping step |
| POST | `/v1/projects/{id}/scene/ops` | Applies an `OpBatch` from the UI (drag move, rotate, scale, delete, colors); rejects with 409 on stale `baseVersion` |
| POST | `/v1/projects/{id}/scene/undo` | Reverts the last batch |
| GET/POST/PATCH/DELETE | `/v1/assets…` | List mine, upload-url, confirm (starts Meshy + enqueues poll), rename / promote (admin), delete |
| POST | `/internal/assets/{id}/poll` | Called by Cloud Tasks `meshy-poll`; verifies OIDC token (`aud` = API URL, `email` = tasks SA); updates status; re-enqueues itself in 15 s until done (max 40 tries) |

Removed after migration: `/v1/auth/login|signup|google|refresh` (browser uses Firebase Auth directly),
per-project furniture endpoints, `/3d-status` (replaced by server-side polling).

### 5.2 New modules
```
app/routers/conversations.py, assets.py, scenes.py, internal.py
app/services/conversation_service.py   create, append_message, set_stage, set_busy, list templates
app/services/orchestrator.py           handle_user_text(), handle_action(); builds Gemini context; tool loop
app/services/gemini_client.py          google-genai wrapper: streaming, tool calling, retries, logging
app/services/tools.py                  registry: name, JSON schema, allowed stages, handler(ctx, args)
app/services/crop_service.py           Pillow crop of the original → planImage; PDF → PNG (pymupdf)
app/services/asset_mapper.py           FloorPlan items → catalog assets for a style (5.4)
app/services/scene_builder.py          FloorPlan + style + mapping → SceneGraph (4.2)
app/services/scene_ops.py              apply/validate/invert OpBatch, write scenes/{id} + ops log
app/services/asset_service.py          library CRUD, Meshy start, poll task enqueue
app/models/conversation.py, scene.py, asset.py
```

### 5.3 Orchestrator and Gemini
- **Context sent to Gemini each turn**: system prompt (role, product rules, current `stage`, what the user
  is expected to do now), the tool list allowed in that stage, a compact project summary (rooms with
  names/areas; items as `id · label · category · position(m) · dims`; style; missing objects), and the
  last 20 messages (text only).
- **Tool loop**: call model → if it returns function calls, execute each via `tools.py` (validate args,
  check stage, apply) → send results back → repeat (max 4 rounds) → final text. Stream final text into
  the assistant message doc (update every ~250 ms). Set `conversations.busy` during the turn.
- **Stage guard**: a tool not allowed in the current stage returns an error result; Gemini then explains.
- **Destructive ops** (delete item, change style after scene exists, re-crop after parse): Gemini must ask
  first; enforce with `requires_confirmation: true` tools that only run when the user's latest message is
  an explicit yes (the orchestrator passes `user_confirmed` in context).
- Log per turn to Cloud Logging: model, latency, tokens, tool calls, errors.

**Tools v1**

| Tool | Stages | Args | Effect |
|---|---|---|---|
| `confirm_crop` | cropping | — | Crops with the latest `stageData.crop` saved by the canvas, triggers parse, stage → parsing |
| `restart_crop` | parsing+, confirm | — | Back to cropping |
| `confirm_plan` | reviewing_plan | — | Stage → choosing_style, posts `style_picker` |
| `select_style` | choosing_style, scene_ready (confirm) | `style` | Runs mapper + builder, posts `mapping_result` or `scene_ready` |
| `skip_missing` | resolving_missing | `componentIds?` (all if empty) | Marks skipped, builds scene, stage → scene_ready |
| `move_item` | scene_ready | `itemId, dx?, dz?, toRoomId?` (m) | `item.move` |
| `rotate_item` | scene_ready | `itemId, degrees` (relative) | `item.rotate` |
| `resize_item` | scene_ready | `itemId, w?, d?, h?, keepRatio=true` (m) | `item.resize` (clamped 0.2×–3× of asset dims) |
| `scale_mapped_item` | resolving_missing | `componentId, w?, d?, h?, percent?, keepRatio=true, applyToSameAsset=true` | Updates `mapping[componentId].dims` |
| `remove_item` | scene_ready, confirm | `itemId` | `item.remove` |
| `replace_item` | scene_ready | `itemId, assetId` | `item.replace` (asset must be same style or user-owned) |
| `add_item` | scene_ready | `assetId, roomId, near?` | `item.add` at room center or beside `near` item, collision-nudged |
| `set_wall_color` | scene_ready | `hex, wallIds?` (all if empty) | `surface.material` tint |
| `set_floor_color` | scene_ready | `hex, roomIds?` | `surface.material` tint |
| `undo_last_change` | scene_ready | — | Reverts last batch |
| `find_assets` | any | `query, style?` | Read-only search in `assets` (name/category), returns ids |

Every scene tool returns `{applied, warnings}`; the orchestrator posts one `scene_change` message per
turn with a summary and Undo.

### 5.4 Asset mapping
1. Normalize plan items: `furnitureType` / `fixtureType` + `label` + room name.
2. Category table (first match wins; refine with room name):

| Plan type | Catalog category | Notes |
|---|---|---|
| bed | Bed | room name contains "master" or largest bed → `*_bed_master` |
| sofa | Sofa | |
| armchair | Armchair | |
| chair | Dining Chair | `Stool` if label says stool (Industrial only) |
| coffee_table | Coffee Table | |
| dining_table, table | Dining Table | `table` in living room → Coffee Table |
| nightstand | Nightstand | Japandi only → missing in Industrial |
| wardrobe, cabinet | Wardrobe & Storage | label "tv" → TV Stand |
| kitchen_island, counter | Kitchen Counter | |
| sink | Kitchen Sink (kitchen) · Bathroom Vanity / Sink (bathroom) | |
| toilet / bathtub | Toilet / Bathtub | |
| refrigerator | Kitchen Appliance (fridge) | |
| washer, dryer | Appliance (washing dryer) | |
| desk, shower, stove, oven, unknown | — | Gemini classifies `label` into a catalog category (one batched call, temperature 0); still none → missing |

3. Several boxes may map to the same asset (chairs). Footprint fit: uniform scale so the model's footprint
   fits the box (no distortion), centered. This is the default; the user can override it (§2.4).
4. Output stored on `projects/{id}.mapping`:
   `{componentId: {assetId | null, dims: {w, d, h} | null, dimsSource: "auto" | "user", skipped: bool}}`;
   unmatched → `missing[]`. Re-running the mapper (style change) keeps `dimsSource: "user"` dims when the new
   asset has the same category.

### 5.5 Walls and colors
- Each wall = box mesh (`length × height × thickness`), centered on the centerline. Door/window openings:
  v1 cuts the wall into segments around openings (door gap to 2.1 m, window gap 0.9–2.1 m with a lintel
  and sill segment). No Meshy.
- Style palettes (editable later in `config/styles.json`):

| Style | Walls | Floor | Accent |
|---|---|---|---|
| Industrial | `#8C8984` (concrete) | `#5A4636` (dark oak) | `#2F3337` (steel) |
| Japandi | `#EFE8DD` (warm white) | `#C8A57A` (light oak) | `#7D8C6A` (sage) |

### 5.6 Worker changes (backend/plan_parsing_worker)
- Input is now the **cropped** image. When `ParsePlanTaskRequest.cropped == true`, skip
  `detect_room_corners` and use the full image as the footprint (one OpenAI call instead of two).
- On completion: write job + project as today, then append a `plan_ready` message
  (`role: system`, `kind`, `payload.stats`) to `conversations/{projectId}/messages`, set conversation
  `stage = reviewing_plan`, `busy = false`. On failure: `plan_failed` + `stage = cropping`.

---

## 6. Frontend (new `web/` app replacing `frontend/`)

```
web/
  index.html, vite.config.ts, src/
    main.tsx, App.tsx, routes.tsx
    lib/ firebase.ts (auth + firestore), api.ts (fetch with ID token), theme.ts, units.ts, config.ts
    layout/ Sidebar.tsx, ProjectList.tsx, ThemeToggle.tsx
    chat/ ChatView.tsx, MessageList.tsx, Composer.tsx, EmptyState.tsx, messageTemplates.ts,
          kinds/ CropRequestCard.tsx, ParseProgressCard.tsx, PlanReadyCard.tsx, StylePickerCard.tsx,
                 MappingResultCard.tsx, SceneReadyCard.tsx, SceneChangeCard.tsx
    canvas/ CanvasPane.tsx, CropCanvas.tsx, PlanEditor/ (ported from app.js: model.ts, render.ts,
            hitTest.ts, interactions.ts, history.ts, Inspector.tsx, AddBoxTool.ts), MissingPanel.tsx,
            Scene3D/ SceneView.tsx, Walls.tsx, Items.tsx (GLTF + fit), IsoCamera.tsx, Toolbar.tsx
    assets/ AssetsPage.tsx, AssetGrid.tsx, AssetCard.tsx, AssetMenu.tsx, EditAssetDialog.tsx,
            UploadAssetDialog.tsx, ModelViewerDialog.tsx
    hooks/ useConversation.ts, useMessages.ts, useProject.ts, useScene.ts, useAssets.ts (onSnapshot)
```
- `config.ts` reads `window.SORAPLAN_CONFIG` (generated by `deploy.sh` as today) plus Firebase web config.
- **PlanEditor port**: move the pure functions from `app.js` (`buildEditorObjectsFromPlan`, `toScreen/toWorld`,
  `drawWall/drawFurniture/drawFixture/drawDimensions`, `hitTest`, `distanceToSegment`, pointer handlers,
  undo/redo) into TS modules with no DOM globals; React only hosts the `<canvas>` and inspector.
  Save = debounced `PUT /v1/projects/{id}/plan` (1 s after last change) + explicit "Looks right".
- **Crop**: the canvas writes the crop rect to the API (`PATCH /v1/conversations/{id}` `stageData.crop`,
  debounced) so that "I'm done" in chat crops exactly what the user sees.
- **3D interaction** (§2.5): raycast picking on item meshes, drag on a floor plane (`Plane(Y=0)`),
  drei `TransformControls`-style custom gizmo (move = floor drag, rotate ring, corner scale), keyboard
  shortcuts, optimistic op store (`hooks/useScene.ts` keeps `pendingOps`, `undoStack`, `redoStack`).
- **3D**: `OrthographicCamera` at azimuth 45°, elevation 35.26° (isometric), auto-fit to scene bounds;
  `OrbitControls` with damping; soft directional light + hemisphere light, contact shadows. Load
  `glbWebPath` with `GLTFLoader` + `MeshoptDecoder`; compute bbox once per asset, cache normalized
  geometry; instance repeated assets.
- Deploy: `deploy.sh frontend` builds `web/` with `npm ci && npm run build` and deploys `web/dist`.
  Keep `frontend/` until M7, then delete.

---

## 7. Catalog preparation (D7)
- `scripts/optimize_catalog.sh`: for each `assets/{Style}/*.glb` run
  `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 1024`
  → upload to `gs://soraplan-catalog/assets-web/{Style}/`. Target ≤ 3 MB per model.
- Measure each optimized model once (bbox w/d/h, which way it faces) and store `dims` + `frontAxis`
  on `assets/{id}`; fix any model that faces −Z/±X with a rotation in metadata, not by re-exporting.
- Two good/bad crop example images in `web/public/examples/` (made from `samples/floorplan_1.png`).

---

## 8. Milestones

Estimates assume one full-time developer familiar with the repo. Each milestone is deployable.

| # | Milestone | Scope | Done when | Est. |
|---|---|---|---|---|
| M0 | Foundations | `web/` scaffold, Firebase Auth login (email + Google), theme tokens + toggle, sidebar shell, routes, `config.ts`, Firestore rules, deploy wiring | Can sign in, toggle theme, see empty sidebar on Hosting | 3 d |
| M1 | Assets page | `assets` collection + migration script, assets API, Meshy poll via Cloud Tasks, compact cards, ⋮ menu, edit/delete/promote, 3D viewer dialog, upload dialog | All 41 system assets visible; upload a photo → GLB appears without manual "check status" | 3 d |
| M2 | Chat core + crop | conversations/messages model, `POST /conversations`, empty state + drop, message list + composer, Gemini client + orchestrator (text only), crop panel + `confirm_crop` (button and chat) | New project from drop; user can ask Gemini a question; crop confirmed both ways | 4 d |
| M3 | Parse + plan review | worker writes `plan_ready`/`plan_failed`, progress card, PlanEditor port + Add box + labels, `PUT /plan`, `confirm_plan` | Parse result appears without refresh; edits survive reload | 4 d |
| M4 | Style + mapping | catalog optimization, style picker, asset mapper, mapping panel with upload-from-box, **scale inspector + 2D scale handles + `PATCH /mapping`**, `skip_missing`, `scale_mapped_item` | Picking a style shows matched/missing; uploaded custom object fills its box; a rescaled sofa keeps its size in 3D | 4 d |
| M5 | 3D scene | scene builder (walls with openings, floors, items), Scene3D isometric view, **select / drag-move / rotate / scale / delete in 3D, keyboard shortcuts, optimistic ops with conflict handling**, color pickers, shared undo | Isometric scene of `samples/floorplan_1.png` in both styles; an item dragged in 3D survives reload and can be undone | 6 d |
| M6 | AI edits | scene tools, confirmation rule, `scene_change` + Undo, prompt + tool eval set (20 utterances) | 18/20 eval utterances call the right tool with valid args | 3 d |
| M7 | Polish + cleanup | motion, mobile layout, empty/error states, remove old endpoints + `frontend/`, docs, GEMINI.md §9–10 | Full flow on phone and desktop; old UI removed | 2 d |

Total ≈ 29 developer-days. M1 can run in parallel with M2 if two people work on it.

---

## 9. Testing
- **Backend (pytest)**: tools (stage guard, arg validation, confirmation rule), asset mapper (table cases
  per style), scene builder (golden SceneGraph for `samples/floorplan_1.png`'s parsed JSON), scene ops
  (apply + invert round-trip), crop service (PDF + image), poll endpoint OIDC check. Gemini mocked.
- **Gemini eval**: `backend/api/evals/chat_tools.jsonl` — utterance, stage, scene fixture, expected tool +
  args tolerance; script prints pass rate. Run before changing prompts or model.
- **Frontend (vitest)**: units/coordinate transforms, PlanEditor hit tests and history, message template
  rendering per kind.
- **E2E (Playwright, staging)**: drop sample plan → crop → (stub parse) → review → style → 3D visible.

## 10. Risks
| Risk | Mitigation |
|---|---|
| Catalog models face different directions / wrong scale | One-time `frontAxis` + `dims` metadata (§7); uniform footprint fit |
| Large GLB downloads | D7 optimization; instancing; lazy-load items after walls render |
| Gemini calls a tool with a wrong item | Compact scene summary with stable ids + room names; stage guard; Undo on every change |
| Parse quality varies with crop | Example images; skip corner pass only when cropped; "Re-crop" path |
| Firestore listener costs | Listen to the open conversation's messages only (limit 100, paginate older); sidebar uses one query |
| Firebase Auth migration breaks existing sessions | Users sign in again once; user docs keyed by the same uid, so data is kept |

## 11. Out of scope (later)
Voice ("ask the architect" with Gemini Live), walk mode, photoreal previews (Nano Banana), sharing
links, multi-floor plans, wall editing in 3D (walls are edited in the 2D review step), switching the parser to Gemini (D4).
