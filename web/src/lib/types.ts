// Shared data contract between the web app and backend/api.
// Firestore field names are camelCase. Scene data is in meters; FloorPlan data is in plan units.
// Firestore cannot store arrays inside arrays, so polygons are lists of {x, z} objects.

export type Stage =
  | "uploading"
  | "cropping"
  | "parsing"
  | "reviewing_plan"
  | "choosing_style"
  | "resolving_missing"
  | "scene_ready";

export type StyleId = "Industrial" | "Japandi";
export const STYLES: StyleId[] = ["Industrial", "Japandi"];

export interface CropRect {
  x: number; // px in the original image
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------- conversations

export interface Conversation {
  id: string;
  ownerUid: string;
  projectId: string;
  title: string;
  stage: Stage;
  stageData: { crop?: CropRect | null };
  busy: boolean;
  busyReason?: "gemini" | "parsing" | "mapping" | "building" | null;
  lastMessageAt?: Date | null;
  lastMessagePreview?: string;
  thumbnailUrl?: string | null;
  /** "scene": a realistic photo of the finished home (generated from the 3D scene); otherwise the uploaded plan. */
  thumbnailKind?: "plan" | "scene" | null;
  /** The scene was rebuilt since the snapshot was taken (the 3D view takes a new one). */
  thumbnailStale?: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export type MessageRole = "user" | "assistant" | "system";

export type MessageKind =
  | "text"
  | "crop_request"
  | "parse_started"
  | "plan_ready"
  | "plan_failed"
  | "style_picker"
  | "mapping_result"
  | "scene_ready"
  | "scene_change"
  | "error";

export interface Message {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  text: string; // markdown
  payload: Record<string, any>;
  status: "streaming" | "done" | "error";
  createdAt?: Date | null;
}

// Payloads per kind (backend writes kind + payload, messageTemplates.ts renders copy)
export interface CropRequestPayload { imageUrl?: string; goodExampleUrl?: string; badExampleUrl?: string }
export interface ParseStartedPayload { jobId: string }
export interface PlanReadyPayload { stats: { rooms: number; walls: number; items: number } }
export interface PlanFailedPayload { error: string }
export interface StylePickerPayload { styles: { id: StyleId; name: string; coverUrl: string; blurb?: string }[]; selected?: StyleId | null }
export interface MappingResultPayload {
  style: StyleId;
  matched: number;
  missing: MissingEntry[];
}
export interface SceneReadyPayload { sceneVersion: number; style: StyleId }
export interface SceneChangePayload { batchId: string; summary: string; undone?: boolean }
export interface ErrorPayload { code: string; message: string; retryAction?: ActionType | null }

export type ActionType =
  | "confirm_crop"
  | "restart_crop"
  | "retry_parse"
  | "confirm_plan"
  | "edit_plan"
  | "select_style"
  | "skip_missing"
  | "continue"
  | "undo_last_change";

// ---------------------------------------------------------------- floor plan (plan units)

export type PlanUnits = "ft" | "m" | "normalized";

export interface PlanPoint { x: number; y: number }

export interface PlanWall {
  id: string;
  type: "wall";
  x1: number; y1: number; x2: number; y2: number;
  thickness: number;
  exterior: boolean;
  confidence?: number;
}

export interface PlanOpening {
  id: string;
  type: "door" | "window";
  x: number; y: number; // center
  width: number;
  rotation: number;
  wallId?: string | null;
  swing?: string | null;
  confidence?: number;
}

/** Furniture & fixtures: (x, y) is the top-left of the unrotated box, rotation (deg, clockwise) about its center. */
export interface PlanBox {
  id: string;
  type: "furniture" | "fixture";
  furnitureType?: string; // furniture only
  fixtureType?: string; // fixture only
  /** Catalog category chosen with the Add box tool ("Sofa", "Dining Chair", ...). Overrides auto classification. */
  category?: string | null;
  label: string;
  x: number; y: number;
  width: number; height: number;
  rotation: number;
  confidence?: number;
  addedBy?: "parser" | "user";
}

export interface PlanRoom {
  id: string;
  name: string;
  polygon: PlanPoint[];
  labelPosition?: PlanPoint | null;
  statedDimensions?: { width?: number | null; height?: number | null } | null;
  confidence?: number;
}

export interface FloorPlan {
  id: string;
  units: PlanUnits;
  width: number;
  height: number;
  sourceImage?: {
    width: number; height: number;
    cropX?: number | null; cropY?: number | null; cropWidth?: number | null; cropHeight?: number | null;
  } | null;
  scaleConfidence?: number;
  rooms: PlanRoom[];
  walls: PlanWall[];
  doors: PlanOpening[];
  windows: PlanOpening[];
  furniture: PlanBox[];
  fixtures: PlanBox[];
  metadata?: Record<string, any> | null;
}

// ---------------------------------------------------------------- project

export interface Dims { w: number; d: number; h: number } // meters: x, z, y

export interface MappingEntry {
  assetId: string | null;
  category: string | null;
  label: string;
  dims: Dims | null; // meters, actual size in the scene
  /** The automatic footprint fit (what "Fit to box" restores and the 50–200 % slider is relative to). */
  autoDims: Dims | null;
  dimsSource: "auto" | "user";
  /** Extra yaw (radians) chosen by the mapper so the model faces away from the nearest wall. */
  rotationOffset?: number;
  skipped: boolean;
}

export interface MissingEntry { componentId: string; label: string; category: string | null }

export interface StoredImage {
  storagePath: string;
  width?: number;
  height?: number;
  contentType?: string;
  fileName?: string;
}

export interface Project {
  id: string;
  ownerUid: string;
  name: string;
  conversationId?: string;
  style?: StyleId | null;
  status?: string;
  planImageOriginal?: StoredImage | null;
  crop?: CropRect | null;
  planImage?: (StoredImage & { signedUrl?: string }) | null;
  floorPlan?: FloorPlan | null;
  floorPlanVersion?: number;
  mapping?: Record<string, MappingEntry>;
  missing?: MissingEntry[];
  currentJobId?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface ProjectFiles { planOriginalUrl: string | null; planUrl: string | null }

export interface Job {
  id: string;
  type: "plan_parse" | "meshy_poll";
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  error?: string | null;
}

// ---------------------------------------------------------------- assets

export type AssetStatus = "uploaded" | "generating_3d" | "ready" | "failed";

export interface Asset {
  id: string;
  ownerUid: string | null;
  isSystem: boolean;
  name: string;
  category: string;
  style: StyleId | null;
  imagePath: string | null;
  glbPath: string | null;
  glbWebPath: string | null;
  /** Ready-to-load URLs: public catalog URLs for system assets, signed URLs (≤ 7 days) for user assets. */
  imageUrl: string | null;
  glbUrl: string | null;
  glbWebUrl: string | null;
  /** Native model bounding box in meters (as exported). Null until measured. */
  dims: Dims | null;
  frontAxis: "+z" | "-z" | "+x" | "-x";
  status: AssetStatus;
  progress: number;
  error?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export const CATALOG_CATEGORIES = [
  "Sofa",
  "Armchair",
  "Coffee Table",
  "TV Stand",
  "Dining Table",
  "Dining Chair",
  "Dining Bench",
  "Stool",
  "Bed",
  "Nightstand",
  "Wardrobe & Storage",
  "Kitchen Counter",
  "Kitchen Sink",
  "Kitchen Appliance",
  "Appliance",
  "Bathtub",
  "Toilet",
  "Bathroom Vanity",
  "Sink",
  "Lighting",
  "Other",
] as const;

// ---------------------------------------------------------------- scene (meters)

export type Vec2 = [number, number]; // (x, z)
export type Vec3 = [number, number, number]; // (x, y, z)

export interface SceneWall {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
  height: number;
  exterior: boolean;
  color?: string | null; // override of meta.palette.wall
}

export interface SceneOpening {
  id: string;
  wallId: string;
  type: "door" | "window" | "opening";
  offset: number; // along the wall from start to opening center (m)
  width: number;
  height: number;
  sillHeight: number;
}

export interface SceneRoom {
  id: string;
  name: string;
  type: string;
  polygon: { x: number; z: number }[];
  area: number;
  floorColor?: string | null; // override of meta.palette.floor
}

export interface ItemInstance {
  id: string;
  assetId: string | null; // null = placeholder box
  componentId?: string | null; // plan component it came from
  label: string;
  category: string | null;
  roomId?: string | null;
  position: Vec3; // bottom-center of the bbox
  rotationY: number; // radians
  dims: Dims; // actual size in the scene
  scaleMode: "uniform" | "free";
  addedBy: "parser" | "user" | "agent";
}

export interface Palette { wall: string; floor: string; accent: string }

export interface Level {
  id: string;
  name: string;
  elevation: number;
  ceilingHeight: number;
  walls: SceneWall[];
  openings: SceneOpening[];
  rooms: SceneRoom[];
  items: ItemInstance[];
}

export interface SceneGraph {
  schemaVersion: "1.0";
  id: string;
  projectId: string;
  version: number;
  units: "m";
  meta: {
    style: StyleId;
    palette: Palette;
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  };
  levels: Level[];
}

export interface SceneDoc {
  version: number;
  graph: SceneGraph;
  undoStack: string[]; // batch ids
  redoStack: string[];
  updatedAt?: Date | null;
}

export type SurfaceTarget =
  | { wallId: string }
  | { roomId: string }
  | { allWalls: true }
  | { allFloors: true };

export type SceneOp =
  | { op: "item.add"; item: ItemInstance }
  | { op: "item.move"; id: string; position: Vec3 }
  | { op: "item.rotate"; id: string; rotationY: number }
  | { op: "item.resize"; id: string; dims: Dims }
  | { op: "item.replace"; id: string; assetId: string }
  | { op: "item.remove"; id: string }
  | { op: "surface.material"; target: SurfaceTarget; material: { tint: string | null } };

export interface OpBatchRequest {
  baseVersion: number;
  ops: SceneOp[];
  origin: "ui";
  label?: string;
}

export interface SceneWarning {
  code: "COLLISION" | "BLOCKS_DOOR" | "OUT_OF_BOUNDS" | "ASPECT_DISTORTED";
  itemIds: string[];
  message: string;
}

export interface OpResult {
  batchId: string;
  newVersion: number;
  applied: number;
  warnings: SceneWarning[];
}

// ---------------------------------------------------------------- user

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
  role: "user" | "admin";
}
