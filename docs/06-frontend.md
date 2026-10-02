# 06 — Frontend (web)

Owner: FE engineer(s). App: `apps/web` — Next.js 15 (App Router), TypeScript strict, React Three Fiber (R3F),
`@react-three/drei`, `@react-three/postprocessing`, `zustand` (+ `immer`), TanStack Query, Tailwind + shadcn/ui,
Firebase JS SDK (Auth, Firestore listeners, Storage not needed — uploads use signed URLs).

The 3D world is the selling point → it gets the most attention: **beauty, smoothness, and trustworthy measurements**.

---

## 1. Routes

| Route | Screen |
|---|---|
| `/` | Landing + "Upload your floor plan" CTA (works as guest via anonymous auth) |
| `/projects` | Project list |
| `/p/[id]/plan` | **Step 1** — upload, parse progress, 2D plan editor, scale calibration |
| `/p/[id]/style` | **Step 2** — style picker, furnishing, room previews (AI images), approve |
| `/p/[id]/world` | **Step 3** — 3D editor (orbit / top-down / walk), library, inspector, architect chat |
| `/s/[token]` | Public read-only share (orbit + walk) |

A persistent stepper (Plan → Style → 3D) lets users go back; all steps edit the same scene.

## 2. State architecture

```
Firestore listener (scenes/{id})  ──► sceneStore.serverScene (version n)
                                         │
UI / gizmo / voice ── SceneOp ──► sceneStore.applyLocal(op)  (scene-core-ts, optimistic)
                                         │     └─ pendingOps queue → POST /ops on commit points
                                         ▼
                               sceneStore.scene (rendered)  ──► derived selectors (wall meshes, bboxes, warnings)
```

- `sceneStore` (zustand): `scene`, `pending`, `undoStack`, `redoStack`, `selection`, `warnings`, `mode`.
- On 409: refetch, re-apply pending ops on top (rebase), retry once; else toast "Scene changed elsewhere".
- `scene-core-ts` (in `packages/scene-schema`): `applyOps`, `validate`, `buildWallGeometry`, `bbox`, `collisions`,
  `clearances`. Must pass the same golden test vectors as Python.
- Jobs: `useJob(jobId)` hook = Firestore `onSnapshot(jobs/{id})` → `{status, stage, progress, result}`.

## 3. Step 1 — Plan editor (2D)

Tech: R3F with an **orthographic camera** (same scene, top-down) — reuse the same geometry code, no separate
canvas library. Or `react-konva` if the team prefers; R3F recommended for code reuse.

Features:
- Upload (drag & drop: JPG/PNG/HEIC/PDF) → signed URL PUT → `plan:parse` → staged progress
  ("Reading dimensions…", "Detecting walls…", "Building rooms…").
- Overlay: original plan image (semi-transparent, aligned with the computed transform) under the parsed vectors
  so the user can see mismatches instantly.
- Tools: select/move wall endpoints (snap 90°, 5 cm grid, magnetic junctions), add/delete wall, add door/window
  (drag along wall), rename/retype room, set ceiling height.
- **"Set a known length"** tool: click two points, type `3.60 m` → `plan:calibrate`. Shown prominently when
  `scale.confidence < 0.7`. Display "Scale: from 4 dimension labels ✓".
- Live dimension labels on every wall (cm / ft-in toggle), room areas in m².
- "Looks good → Continue" commits and moves to Step 2. A quick **3D peek** button (extruded walls) builds trust early.

## 4. Step 2 — Style & preview

- Style cards (Japandi, Scandinavian, Modern Luxe, Industrial, Mid-century, Coastal, Minimal) + free-text prompt
  + optional inspiration images upload.
- "My furniture" drawer: upload photos of own furniture → shows asset pipeline stages
  (Understanding → Cleaning photo → Generating 3D → Scaling to real size → Ready) with live thumbnails.
  Must-include toggle: "Use my sofa in the living room".
- **Furnish** → design job → rooms fill with items (top-down view updates live as ops arrive).
- Per-room **preview cards**: client renders the blockout (see §7.4) → uploads → render job → photoreal image.
  Draft (fast) by default; "Make it final (HD)" button. "Preview out of date" badge when `sceneVersion` changed.
- Each preview card: room name, items list (swap / remove), materials (swap), "Regenerate", "Approve".
- Critic suggestions list with one-click apply.
- CTA: **Enter 3D world** (enabled anytime; previews are optional).

## 5. Step 3 — 3D world (the main event)

### 5.1 Layout
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Plan][Style][3D]   Project name       ⟲ ⟳   View: Orbit|Top|Walk  📷  ⤴ │
├────────┬─────────────────────────────────────────────────────┬───────────┤
│Library │                                                     │ Inspector │
│ search │                 3D CANVAS                           │ Name      │
│ cats   │                                                     │ W 210 cm  │
│ My     │    (selected item: gizmo + live dimension lines     │ D  95 cm  │
│ items  │     + distance to nearest walls)                    │ H  80 cm  │
│ Mats   │                                                     │ Rot 90°   │
│        │                                                     │ Material  │
│        │                       ⚠ Blocks door swing           │ Replace…  │
├────────┴─────────────────────────────────────────────────────┴───────────┤
│ 🎙 Ask the architect: "move the sofa 50 cm toward the window"            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Camera modes
- **Orbit** (`CameraControls` from drei): smooth damping, double-click to focus item/room, cut-away walls.
- **Top-down** (orthographic, plan-like) with dimension overlays — great for precise placement.
- **Walk** (first person): `PointerLockControls` on desktop, virtual joystick + drag-look on mobile; eye height
  1.6 m; collision with walls via simple 2D capsule vs wall segments (we have the plan — no physics engine needed);
  doors are walkable openings. Minimap with position/direction. Teleport by clicking floor.
- **Wall cut-away**: in orbit, walls between camera and room center fade to 15% / are lowered to 1 m ("dollhouse"
  look) — implement via per-wall dot(camDir, wallNormal) each frame.
- Smooth camera transitions between modes (`camera-controls` `setLookAt(..., true)`).

### 5.3 Interaction & real-measurement features (the differentiator)
- Select item: outline (postprocessing `Outline`), inspector opens.
- Move: drag on the floor plane (raycast on y=0), constrained to room; **snap** to walls (back-against-wall with
  1 cm gap), to other items' edges, to 5 cm grid (hold Alt to disable). Rotate: handle ring with 15° snaps
  (Shift = free). Wall-mounted items slide along walls; `on_top` items snap onto surfaces.
- Resize: corner/edge handles **in real units**; inspector numeric inputs (cm/in). Rules by `scaleMode`:
  - `uniform` (default for organic meshes): proportional only;
  - `free`: per-axis allowed within `maxAspectDistortion` (e.g. ±15%) — beyond that, show
    "⚠ Stretching distorts this model — try a different size variant" and offer catalog alternatives of that size;
  - `parametric`: rebuild geometry at new dims (cabinets, shelves) — no distortion.
- **Live dimension lines** while dragging: distances to the nearest wall on each side and to neighboring items
  (`drei <Html>` labels or SDF text via `troika-three-text`).
- **Measure tool**: click-click tape measure anywhere (snap to vertices/edges).
- **Warnings** (from scene-core): collision (red tint), clearance (< 90 cm walkway path – show a translucent red
  zone on the floor), door-swing blocked (show the door arc), "doesn't fit through the door" for large items.
- Duplicate (Ctrl+D), delete, lock, undo/redo (Ctrl+Z / Ctrl+Shift+Z), multi-select (Shift-click).
- Swap furniture: "Replace…" shows catalog items with similar category & dims (vector search + dims filter);
  keeps pose.
- Materials: drag a material from the library onto a floor/wall, or pick in inspector; item material slots
  (e.g., sofa fabric) via Meshy Retexture job (shows a shimmer while generating).
- Library drag & drop into the scene → item appears with correct real dims, auto-snaps to nearest wall.
- "Ask the architect" bar: text or push-to-talk (Gemini Live). Changes animate in (tween position/rotation 300 ms)
  and are grouped as one undo step labelled with the utterance.

### 5.4 Asset loading
- `useGLTF` with **Meshopt** decoder + **KTX2Loader** (Basis transcoder from CDN path we host).
- Each `ItemInstance` component: load GLB → compute native bbox once (cached by assetId) → set scale =
  `dims / nativeDims` (per axis; uniform if `scaleMode=uniform`) → position bottom-center at `position`.
- While loading / generating: **proxy box with exact dims** + thumbnail billboard + subtle pulse. Never block.
- LOD: `<Detailed>` with LOD0 (full) / LOD1 (glbLod1) at distance > 8 m; mobile always LOD1.
- Instancing for repeated items (dining chairs) via `<Merged>`/`Instances` when > 3 of the same asset.

## 6. Rendering quality ("make it beautiful")

| Feature | Implementation |
|---|---|
| Color pipeline | `THREE.ColorManagement` on, sRGB output, **AgX** (or ACES Filmic) tone mapping, exposure 1.0 |
| Image-based lighting | drei `<Environment files="/hdri/interior_soft_2k.hdr">` (Poly Haven CC0), background off inside |
| Sunlight | One `DirectionalLight` through windows with soft shadows (PCFSoft / `SoftShadows`), shadow camera fitted to home bbox |
| Ambient occlusion | `@react-three/postprocessing` **N8AO** (high quality, cheap) |
| Contact grounding | `ContactShadows` under furniture in orbit mode |
| Anti-aliasing | SMAA (or MSAA via `multisampling` on the composer) |
| Extras | Subtle bloom for lamps, vignette; light probes per room (stretch) |
| Architecture | Walls built procedurally (`ExtrudeGeometry` of wall footprint with opening holes via `three-bvh-csg` or by splitting into segments around openings — the latter is faster & simpler); baseboards; window glass `MeshPhysicalMaterial` transmission; floor with PBR tile maps, `uvScale` from material `tileSize` |
| **Photo mode** | `three-gpu-pathtracer` progressive path tracing of the current view → share-worthy still in ~10–30 s; download PNG |
| Quality tiers | Auto-detect GPU (`detect-gpu`): High (all effects), Medium (no N8AO half-res), Low/mobile (no shadows on small items, LOD1, no post) — `PerformanceMonitor` from drei to auto-degrade |

Targets: 60 fps desktop (integrated GPU OK on Medium), 30 fps mid-range phone; first meaningful 3D < 3 s with
proxies; full assets < 8 s on 4G.

## 7. Key components (suggested)

```
components/
  world/
    WorldCanvas.tsx           Canvas, gl settings, quality tier, postprocessing
    Architecture.tsx          walls/floors/ceilings from scene (memoized by level version)
    Wall.tsx  Floor.tsx  Opening.tsx (door/window models)
    Item.tsx                  GLB/parametric/proxy + selection + LOD
    parametric/Cabinet.tsx Shelf.tsx Table.tsx ...   (dims-driven procedural models)
    Gizmo.tsx                 move/rotate/resize handles in meters
    DimensionLines.tsx  MeasureTool.tsx  WarningsLayer.tsx  DoorSwing.tsx
    cameras/OrbitRig.tsx TopRig.tsx WalkRig.tsx Minimap.tsx
    PhotoMode.tsx             path tracer
    BlockoutCapture.tsx       clay + ID + depth passes for AI preview
  plan/  PlanEditor.tsx  CalibrateTool.tsx  WallTool.tsx  OpeningTool.tsx
  library/  LibraryPanel.tsx  AssetCard.tsx  UploadFurniture.tsx  MaterialsPanel.tsx
  inspector/  Inspector.tsx  DimsInput.tsx (cm/in)
  architect/  ArchitectBar.tsx  useGeminiLive.ts
lib/
  api.ts  firebase.ts  units.ts  useJob.ts
  scene/  store.ts  ops.ts (re-export scene-core-ts)  selectors.ts
```

### 7.4 Blockout capture for AI previews
`BlockoutCapture` renders the current scene offscreen (`WebGLRenderTarget` 1536×1024) with an override
material: walls white, floor light grey, items in neutral clay `MeshStandardMaterial` (keeps silhouettes),
plus an ID pass (`MeshBasicMaterial` unique color per item) and a depth pass. Exports to WebP blobs → upload →
`POST /renders`. Camera presets per room: "from doorway", "corner wide", "top-down".

## 8. Gemini Live integration (`useGeminiLive`)
- `POST /v1/live/token` → ephemeral token → `@google/genai` Live client in browser (WebSocket), 16 kHz mic
  capture via `AudioWorklet`, play 24 kHz response audio.
- Tool calls → map to SceneOps through `architectTools.ts` → `applyLocal` → commit → send `toolResponse`
  (`{ok, warnings, newDims, distanceToWall}`) so the model can speak the result.
- Context updates: on selection change, send `{selected: {id, name, dims, room}}` as a client content turn.

## 9. Accessibility, i18n, responsiveness
- Keyboard: arrows nudge 1 cm (Shift 10 cm), R rotate 90°, Del delete, F focus.
- Units toggle metric/imperial persisted per user. All copy in `messages/en.json` (next-intl), ready for `vi`.
- Mobile: 3D view + bottom sheet inspector; walk mode with joystick; plan editing desktop-first.

## 10. Testing
- Vitest for `scene-core-ts`, stores, units. Playwright e2e: upload sample plan (fixtures + mocked jobs) →
  edit → enter world → move item → assert committed op. Visual regression on blockout render (pixelmatch).
