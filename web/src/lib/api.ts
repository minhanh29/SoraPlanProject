// REST client for backend/api. Every call carries the Firebase ID token.
import { auth } from "./firebase";
import { config } from "./config";
import type {
  ActionType,
  Asset,
  CropRect,
  Dims,
  FloorPlan,
  Job,
  MappingEntry,
  OpBatchRequest,
  OpResult,
  ProjectFiles,
  StyleId,
  UserProfile,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${config.apiBaseUrl}${path}`, { ...init, method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const code = (data && (data.code || data.detail?.code)) || `HTTP_${res.status}`;
    const message = (data && (typeof data.detail === "string" ? data.detail : data.title)) || res.statusText;
    throw new ApiError(res.status, code, message);
  }
  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

/** PUT a file to a V4 signed URL with progress (0–100). */
export function uploadToSignedUrl(url: string, file: Blob, contentType: string, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed (network)"));
    xhr.send(file);
  });
}

export const api = {
  me: () => request<UserProfile>("GET", "/users/me"),
  /** Also marks a job that stopped making progress as failed (and resets its chat). */
  job: (id: string) => request<Job>("GET", `/jobs/${id}`),

  // conversations (1 conversation = 1 project, same id)
  createConversation: (file: { fileName: string; contentType: string; sizeBytes: number }) =>
    request<{ projectId: string; conversationId: string; signedUploadUrl: string; contentType: string }>(
      "POST",
      "/conversations",
      file,
    ),
  uploadComplete: (id: string) => request<{ stage: string }>("POST", `/conversations/${id}/upload-complete`),
  sendMessage: (id: string, text: string) => request<{ messageId: string }>("POST", `/conversations/${id}/messages`, { text }),
  stop: (id: string) => request<{ ok: boolean }>("POST", `/conversations/${id}/stop`),
  action: (id: string, type: ActionType, args: Record<string, unknown> = {}) =>
    request<{ ok: boolean; result?: any }>("POST", `/conversations/${id}/actions`, { type, args }),
  updateConversation: (id: string, patch: { title?: string; stageData?: { crop?: CropRect } }) =>
    request<{ ok: boolean }>("PATCH", `/conversations/${id}`, patch),
  deleteConversation: (id: string) => request<void>("DELETE", `/conversations/${id}`),

  // project
  projectFiles: (id: string) => request<ProjectFiles>("GET", `/projects/${id}/files`),
  savePlan: (id: string, floorPlan: FloorPlan) =>
    request<{ floorPlanVersion: number }>("PUT", `/projects/${id}/plan`, { floorPlan }),
  updateMapping: (
    id: string,
    body: { componentId: string; dims?: Dims | null; assetId?: string | null; applyToSameAsset?: boolean; reset?: boolean; restore?: boolean },
  ) => request<{ mapping: Record<string, MappingEntry> }>("PATCH", `/projects/${id}/mapping`, body),

  // scene
  applyOps: (id: string, batch: OpBatchRequest) => request<OpResult>("POST", `/projects/${id}/scene/ops`, batch),
  undo: (id: string) => request<{ newVersion: number }>("POST", `/projects/${id}/scene/undo`),
  redo: (id: string) => request<{ newVersion: number }>("POST", `/projects/${id}/scene/redo`),

  // assets
  listAssets: (scope: "system" | "mine") => request<Asset[]>("GET", `/assets?scope=${scope}`),
  assetUploadUrl: (file: { fileName: string; contentType: string; sizeBytes: number }) =>
    request<{ assetId: string; signedUploadUrl: string; contentType: string }>("POST", "/assets/upload-url", file),
  confirmAsset: (
    id: string,
    body: { name: string; category: string; style?: StyleId | null; projectId?: string; componentId?: string },
  ) => request<Asset>("POST", `/assets/${id}/confirm`, body),
  updateAsset: (id: string, patch: { name?: string; category?: string; style?: StyleId | null; isSystem?: boolean }) =>
    request<Asset>("PATCH", `/assets/${id}`, patch),
  deleteAsset: (id: string) => request<void>("DELETE", `/assets/${id}`),
  removeBackground: (file: Blob, name: string) => {
    const form = new FormData();
    form.append("file", file, "photo");
    form.append("name", name);
    return request<{ dataUri: string }>("POST", "/assets/remove-background", form);
  },
};
