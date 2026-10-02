# 05 — Backend (api service)

Owner: BE engineer. Service: `services/api` — Python 3.12, FastAPI, Pydantic v2, `firebase-admin`,
`google-cloud-firestore`, `google-cloud-storage`, `google-cloud-tasks`. Deployed on Cloud Run.

## 1. Project structure

```
services/api/
├── app/
│   ├── main.py                 # FastAPI app, routers, middleware (auth, request id, CORS)
│   ├── deps.py                 # get_current_user (Firebase ID token), firestore/gcs clients
│   ├── routers/
│   │   ├── projects.py  uploads.py  plans.py  scenes.py  design.py
│   │   ├── renders.py   assets.py   materials.py  jobs.py  live.py  share.py
│   │   └── internal.py         # Cloud Tasks / Meshy webhook callbacks (OIDC-protected)
│   ├── schema/                 # generated from packages/scene-schema (DO NOT EDIT)
│   ├── scene_core/             # apply_ops, validate, geometry (shared lib, also used by ai-worker)
│   ├── services/
│   │   ├── jobs.py             # create_job, enqueue (Cloud Tasks), idempotency
│   │   ├── storage.py          # signed URLs, paths
│   │   ├── quota.py
│   │   └── live_tokens.py      # Gemini Live ephemeral tokens
│   └── settings.py             # pydantic-settings, env-driven
├── tests/  Dockerfile  pyproject.toml
```

`scene_core` is a **shared Python package** (`packages/scene-core-py`) consumed by api and ai-worker. A TS
port with the same test vectors (`packages/scene-schema/test-vectors/*.json`) lives in the web app so the
client can apply ops optimistically and show identical warnings.

## 2. REST API (v1)

Auth: `Authorization: Bearer <Firebase ID token>` on all routes except `/share/*` (public read) and
`/internal/*` (Cloud Tasks OIDC / Meshy webhook secret). JSON, snake_case on the wire is **not** used —
use camelCase to match the TS schema (Pydantic `alias_generator=to_camel`).

### Projects & uploads
| Method | Path | Body / Notes | Response |
|---|---|---|---|
| POST | `/v1/projects` | `{name}` | `Project` |
| GET | `/v1/projects` | list own | `Project[]` |
| GET/PATCH/DELETE | `/v1/projects/{id}` | | |
| POST | `/v1/uploads` | `{kind: "plan"\|"furniture"\|"inspiration"\|"material", contentType, size}` | `{uploadId, url (V4 signed PUT), expiresAt}` |

### Plan
| POST | `/v1/projects/{id}/plan:parse` | `{uploadId, hints?: {knownLength?: {p1px, p2px, meters}}}` | `202 {jobId}` |
| POST | `/v1/projects/{id}/plan:calibrate` | `{p1: Vec2, p2: Vec2, meters}` (scene coords or px) | `{sceneVersion, pxPerMeter}` — rescales the whole scene |

### Scenes
| GET | `/v1/scenes/{id}` | `?version=` optional | `SceneGraph` |
| POST | `/v1/scenes/{id}/ops` | `OpBatch` | `200 OpResult` / `409 {currentVersion}` / `422 {rejected}` |
| GET | `/v1/scenes/{id}/history` | paginated op batches | |
| POST | `/v1/scenes/{id}:restore` | `{version}` | new version |
| POST | `/v1/scenes/{id}:validate` | dry-run ops | `{warnings}` |

### Design & rendering
| POST | `/v1/scenes/{id}/design` | `{roomIds?: string[], style: StyleProfile, keepExisting: bool}` | `202 {jobId}` |
| POST | `/v1/scenes/{id}/critique` | `{roomId?}` | `202 {jobId}` → result: suggestions (SceneOps + reason) |
| POST | `/v1/scenes/{id}/renders` | `{roomId, camera, quality: "draft"\|"final", blockoutUploadId, idPassUploadId?}` | `202 {jobId, renderId}` |
| GET | `/v1/scenes/{id}/renders` | | `Render[]` |

### Assets & materials
| GET | `/v1/assets` | `?q=&category=&style=&owner=me\|system\|all&cursor=` — `q` uses vector search | `Asset[]` |
| POST | `/v1/assets` | `{uploadIds: string[], hint?: {category?, dims?, name?}}` | `202 {assetId, jobId}` |
| PATCH | `/v1/assets/{id}` | `{dims, name, category, resize}` — user confirms dims | `Asset` |
| POST | `/v1/assets/{id}:retexture` | `{prompt?, materialImageUploadId?}` → Meshy Retexture → new asset variant | `202 {assetId, jobId}` |
| GET | `/v1/materials` | `?q=&category=` | `Material[]` |

### Jobs, live, share
| GET | `/v1/jobs/{id}` | (clients normally use Firestore listener) | `Job` |
| POST | `/v1/jobs/{id}:cancel` | | |
| POST | `/v1/live/token` | `{sceneId}` | `{token, expiresAt, model, config}` |
| POST | `/v1/projects/{id}/share` | `{mode: "view"}` | `{shareUrl}` |
| GET | `/share/{token}` | public read-only scene + asset URLs | |

### Internal
| POST | `/internal/tasks/{type}` | Cloud Tasks push (OIDC verified, service account allow-list) — only if api hosts handlers |
| POST | `/internal/webhooks/meshy` | verify secret header → update job → enqueue `asset-normalize` |

## 3. Op commit algorithm (`POST /scenes/{id}/ops`)

```python
@firestore.transactional
def commit(tx, scene_ref, batch: OpBatch, user):
    snap = scene_ref.get(transaction=tx)
    scene = SceneGraph.model_validate(snap.get("graph"))
    authorize(user, scene)
    if batch.base_version != scene.version:
        if not all(op_is_rebase_safe(o) for o in batch.ops):   # item.* ops on different ids are safe
            raise Conflict(current_version=scene.version)
    new_scene, result = scene_core.apply_ops(scene, batch.ops)   # pure function; collects warnings/rejections
    if result.rejected and batch.origin == "ui": raise Unprocessable(result)
    new_scene.version = scene.version + 1
    tx.update(scene_ref, {"graph": new_scene.model_dump(by_alias=True), "version": new_scene.version})
    tx.create(scene_ref.collection("ops").document(), {...batch, "result": result, "createdAt": SERVER_TIMESTAMP})
    if new_scene.version % 20 == 0: write_snapshot(...)
    return result
```

Drag interactions: client applies locally at 60 fps and only commits on **pointer-up** (debounced 300 ms) —
keeps write rate low (Firestore ~1 write/s/doc sustained guideline).

## 4. Jobs service

```python
def create_job(type, owner, project_id, input, idempotency_key=None) -> str:
    job_id = idempotency_key and hash(...) or new_ulid("job")
    db.document(f"jobs/{job_id}").create({...status:"queued", progress:0})   # AlreadyExists → return existing
    tasks.create_task(parent=queue_path(type), task={
        "name": f"{queue_path(type)}/tasks/{job_id}",
        "http_request": {"url": WORKER_URL[type] + f"/tasks/{type}", "oidc_token": {...}, "body": json({"jobId": job_id})},
        "dispatch_deadline": "1800s"})
    return job_id
```

Worker contract (both workers): `POST /tasks/{type} {jobId}` → load job → if status in (succeeded, failed,
canceled) return 200 → set running → do work, calling `report(stage, progress)` → write result → 200.
Return 5xx to let Cloud Tasks retry; mark `failed` only on final attempt (`X-CloudTasks-TaskRetryCount`).

## 5. Errors

RFC 7807 problem JSON: `{type, title, status, detail, code, requestId}`. Codes: `QUOTA_EXCEEDED`,
`SCENE_VERSION_CONFLICT`, `OPS_REJECTED`, `UPLOAD_NOT_FOUND`, `UNSUPPORTED_FILE`, `PROVIDER_UNAVAILABLE`.

## 6. Quotas (free tier defaults, configurable)
`projects: 5, renders_final/day: 20, renders_draft/day: 100, assets3d/month: 10, plan_parses/day: 20`.

## 7. Testing
- Unit: `scene_core` (100% of op types, golden test vectors shared with TS).
- API: `pytest` + Firestore emulator + fake Cloud Tasks (in-process dispatcher) + fake providers.
- Contract: schemathesis against OpenAPI.
- Local dev: `docker compose up` → api, ai-worker, asset-worker, Firebase emulators (auth, firestore, storage);
  `TASKS_MODE=inline` dispatches jobs directly via HTTP to the local worker.
