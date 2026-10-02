# 03 — Data Model (the contract)

Source of truth: `packages/scene-schema/` (JSON Schema 2020-12). Generate:
- TS types → `json-schema-to-typescript` → `packages/scene-schema/dist/index.d.ts`
- Pydantic v2 → `datamodel-code-generator` → `services/*/app/schema/scene.py`

Conventions: meters, Y-up, floor y=0; plan coordinates are `(x, z)`; rotations in radians around Y unless
noted; IDs are short ULIDs with a prefix (`wal_…`, `opn_…`, `rom_…`, `itm_…`, `ast_…`).

---

## 1. SceneGraph

```ts
interface SceneGraph {
  schemaVersion: "1.0";
  id: string;                    // scn_...
  projectId: string;
  version: number;               // monotonically increasing, bumped on every committed op batch
  units: "m";
  meta: {
    source: { planImageId?: string; scaleMethod: "dimension_label" | "door_heuristic" | "user_reference" | "manual";
              pxPerMeter?: number; confidence: number };
    style?: StyleProfile;
    northAngle?: number;         // for sunlight (stretch)
  };
  levels: Level[];               // v1: exactly one level
}

interface Level {
  id: string;                    // lvl_...
  name: string;                  // "Ground floor"
  elevation: number;             // 0
  ceilingHeight: number;         // default 2.7
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: ItemInstance[];
  lights: LightInstance[];
}

interface Wall {
  id: string;
  start: Vec2; end: Vec2;        // centerline, meters
  thickness: number;             // default 0.12 interior, 0.2 exterior
  height: number;                // default = level.ceilingHeight
  exterior: boolean;
  materials: { left: MaterialRef; right: MaterialRef };  // side relative to start→end direction
}

interface Opening {
  id: string;
  wallId: string;
  type: "door" | "window" | "opening" | "sliding_door" | "double_door";
  offset: number;                // distance along wall from start to opening center (m)
  width: number;                 // door default 0.9, window 1.2
  height: number;                // door 2.1, window 1.2
  sillHeight: number;            // door 0, window 0.9
  hinge?: "left" | "right";      swing?: "in" | "out";
  assetId?: string;              // optional parametric door/window model
}

interface Room {
  id: string;
  name: string;                  // "Living room"
  type: RoomType;                // living | bedroom | kitchen | bathroom | dining | office | hallway | balcony | other
  polygon: Vec2[];               // CCW, closed implicitly
  area: number;                  // computed, m²
  floor: MaterialRef;
  ceiling: MaterialRef;
  labelFromPlan?: string;        // raw OCR text
}

interface ItemInstance {
  id: string;                    // itm_...
  assetId: string;               // ast_...
  roomId?: string;
  position: Vec3;                // bottom-center of bbox, meters
  rotationY: number;             // radians
  dims: Dims;                    // ACTUAL size in scene (W x D x H, m) — the truth for scale
  scaleMode: "uniform" | "free" | "parametric";
  materialOverrides?: Record<string /*slot*/, MaterialRef>;
  locked?: boolean;
  mount?: "floor" | "wall" | "ceiling" | "on_top";
  parentId?: string;             // e.g. lamp on a table
  addedBy: "user" | "agent" | "parser";
}

interface Dims { w: number; d: number; h: number }   // x, z, y
type Vec2 = [number, number]; type Vec3 = [number, number, number];

interface MaterialRef { materialId: string; uvScale?: number; rotation?: number; tint?: string /*#hex*/ }

interface LightInstance { id: string; kind: "ceiling" | "pendant" | "lamp" | "spot"; position: Vec3;
                          intensity: number; colorTemp: number; assetId?: string }

interface StyleProfile { name: string; prompt: string; palette: string[]; budget?: "low"|"mid"|"high";
                         referenceImageIds?: string[] }
```

### Derived (never stored, computed by `scene-core` lib in both TS and Python)
- Wall meshes with opening cut-outs, room floor/ceiling meshes, wall-join miters.
- Item world bbox, collisions, clearances, room membership.

## 2. SceneOps (all mutations)

```ts
type SceneOp =
  | { op: "wall.add"; wall: Wall } | { op: "wall.update"; id: string; patch: Partial<Wall> } | { op: "wall.remove"; id: string }
  | { op: "opening.add"; opening: Opening } | { op: "opening.update"; id: string; patch: Partial<Opening> } | { op: "opening.remove"; id: string }
  | { op: "room.upsert"; room: Room } | { op: "room.remove"; id: string }
  | { op: "item.add"; item: ItemInstance }
  | { op: "item.move"; id: string; position: Vec3 }
  | { op: "item.rotate"; id: string; rotationY: number }
  | { op: "item.resize"; id: string; dims: Dims }
  | { op: "item.replace"; id: string; assetId: string }        // keep pose, swap model
  | { op: "item.material"; id: string; slot: string; material: MaterialRef }
  | { op: "item.remove"; id: string }
  | { op: "surface.material"; target: { roomId: string; surface: "floor"|"ceiling" } | { wallId: string; side: "left"|"right" }; material: MaterialRef }
  | { op: "level.update"; id: string; patch: Partial<Pick<Level,"ceilingHeight"|"name">> }
  | { op: "meta.style"; style: StyleProfile };

interface OpBatch { sceneId: string; baseVersion: number; ops: SceneOp[]; origin: "ui"|"agent"|"voice"|"parser"; label?: string }
interface OpResult { newVersion: number; applied: number; warnings: Warning[]; rejected?: { index: number; reason: string }[] }
interface Warning { code: "COLLISION"|"CLEARANCE"|"BLOCKS_DOOR"|"OUT_OF_ROOM"|"OVERSIZE_FOR_DOOR"|"ASPECT_DISTORTED"; itemIds: string[]; message: string; severity: "info"|"warn"|"error" }
```

Undo/redo: client keeps inverse ops per batch. Server stores every batch in `scenes/{s}/ops` (audit + replay).

## 3. Asset (furniture & materials catalog)

```ts
interface Asset {
  id: string;                     // ast_...
  owner: "system" | string;       // uid for user-uploaded
  kind: "mesh" | "parametric";
  category: FurnitureCategory;    // sofa, armchair, bed, table, chair, desk, wardrobe, shelf, cabinet, lamp, plant, rug, decor, appliance, bath, kitchen, door, window
  name: string; description: string; tags: string[];
  styleTags: string[];            // scandinavian, japandi, industrial, mid-century, ...
  dims: Dims;                     // real-world default dims (m) — confirmed
  dimsSource: "catalog" | "user" | "ai_estimate";
  resize: { mode: "uniform"|"free"|"parametric"; min?: Dims; max?: Dims; maxAspectDistortion?: number /*0.15*/ };
  mount: "floor"|"wall"|"ceiling"|"on_top";
  clearance: { front: number; sides: number; back: number };   // e.g. bed front 0.6
  files: {
    glb?: string; glbLod1?: string; usdz?: string;              // gs:// paths, CDN served
    thumbnail: string; views?: { front: string; right: string; back: string; left: string };
    parametricModule?: string;                                   // e.g. "parametric/cabinet@1"
  };
  materialSlots?: string[];       // mesh material names that can be overridden ("fabric", "legs")
  source: { type: "preset"|"user_photo"|"meshy_text"; imageIds?: string[]; provider?: "meshy"|"tripo";
            providerTaskId?: string; model?: string; contentHash: string };
  status: "queued"|"preparing"|"generating"|"normalizing"|"qa"|"needs_review"|"ready"|"failed";
  stage?: string; progress?: number; error?: string;
  embedding?: VectorValue;        // Gemini Embedding 2 (multimodal: thumbnail + text), Firestore vector field
  price?: { amount: number; currency: string; url?: string };  // stretch: shoppable
  createdAt: Timestamp;
}

interface Material {
  id: string;                     // mat_oak_light
  name: string; category: "wood"|"tile"|"stone"|"paint"|"fabric"|"metal"|"carpet"|"concrete"|"wallpaper";
  maps: { baseColor: string; normal?: string; roughness?: string; ao?: string; metallic?: string }; // KTX2
  tileSize: number;               // meters per texture repeat
  swatch: string;                 // thumbnail
  owner: "system" | string; embedding?: VectorValue;
}
```

## 4. Firestore layout

```
users/{uid}                         { displayName, plan, quota: {renders, assets3d, resetAt} }
projects/{projectId}                { ownerUid, name, createdAt, updatedAt, currentSceneId, thumbnail, status }
  └ planImages/{imgId}             { gcsPath, width, height, pages, uploadedAt }
scenes/{sceneId}                    { projectId, ownerUid, version, graph: SceneGraph (≤ ~500 KB) }
  ├ ops/{batchId}                  OpBatch + OpResult + createdAt
  ├ snapshots/{version}            full graph every 20 versions (fast restore/time travel)
  └ renders/{renderId}             { roomId, camera, imagePath, prompt, model, sceneVersion, status }
assets/{assetId}                    Asset (system + user; query by owner in [system, uid])
materials/{materialId}              Material
jobs/{jobId}                        { type, ownerUid, projectId, status, stage, progress, input, result, error, attempts, createdAt, updatedAt }
assetsByHash/{sha256}               { assetId }   // dedupe
```

Vector index: `assets.embedding` (dimension per Gemini Embedding config, cosine), composite filter on
`owner`, `category`. Same for `materials.embedding`.

If `graph` approaches the 1 MiB document limit (very large homes), move it to GCS
(`scenes/{id}/v{n}.json`) and keep a pointer — implement the pointer path from day 1 behind a helper.

## 5. Cloud Storage layout

```
gs://soraplan-uploads-{env}/{uid}/{uploadId}.{ext}              (lifecycle: delete after 30 d if orphaned)
gs://soraplan-assets-{env}/assets/{assetId}/{hash}/model.glb    (CDN)
                                         /{hash}/model_lod1.glb
                                         /{hash}/model.usdz
                                         /{hash}/thumb.webp, views/*.webp
gs://soraplan-assets-{env}/materials/{materialId}/{map}.ktx2
gs://soraplan-renders-{env}/{projectId}/{renderId}.webp           (CDN, signed if private)
gs://soraplan-assets-{env}/raw/{assetId}/meshy_{taskId}.glb       (original, for reprocessing)
```
