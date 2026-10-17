# SoraPlan API (`backend/api`)

FastAPI service behind the chat-first web app (`web/`). The browser signs in with the Firebase Auth JS SDK,
reads Firestore live (read-only rules) and sends every write here with its Firebase ID token.
Design: [`docs/10-chat-refactor-plan.md`](../../docs/10-chat-refactor-plan.md).

## Endpoints (`/v1`, Bearer Firebase ID token)

| Method | Path | Purpose |
|---|---|---|
| GET/PATCH | `/users/me` | Profile; `role` comes from `ADMIN_UIDS` |
| POST | `/conversations` | Start a project from a plan file → `{projectId, conversationId, signedUploadUrl}` |
| POST | `/conversations/{id}/upload-complete` | PDF page 1 → PNG, EXIF fix, thumbnail; stage → `cropping` |
| POST | `/conversations/{id}/messages` | Chat turn: Gemini + tool loop, reply streamed into Firestore |
| POST | `/conversations/{id}/stop` | Stop the reply being generated |
| POST | `/conversations/{id}/actions` | UI buttons, same handlers as the Gemini tools (`confirm_crop`, `confirm_plan`, `select_style`, `skip_missing`, `continue`, `edit_plan`, `restart_crop`, `retry_parse`, `undo_last_change`) |
| PATCH / DELETE | `/conversations/{id}` | Rename / save `stageData.crop` · delete chat, project, scene, files |
| GET | `/projects`, `/projects/{id}`, `/projects/{id}/plan` | Read projects |
| GET | `/projects/{id}/files` | Fresh signed URLs of the original and cropped plan |
| PUT | `/projects/{id}/plan` | Save the edited 2D plan (bumps `floorPlanVersion`) |
| PATCH | `/projects/{id}/mapping` | Rescale a matched model, reset it, or assign an asset to a box |
| POST | `/projects/{id}/scene/ops` · `/scene/undo` · `/scene/redo` | 3D edits as op batches (409 `SCENE_VERSION_CONFLICT`); history shared with AI edits |
| GET / POST / PATCH / DELETE | `/assets…` | Library: list (`scope=system|mine`), upload URL, confirm (starts Meshy), edit / promote (admin), delete |
| POST | `/assets/remove-background` | Cut furniture out of a photo (proxied to the private worker) |
| GET | `/jobs/{id}` | Parse job status (marks stale jobs failed and resets the chat) |
| POST | `/internal/assets/{id}/poll` | Cloud Tasks only (OIDC token of `TASKS_INVOKER_SA`, audience `API_PUBLIC_URL`) |

## Layout

```
app/routers/      conversations, projects, scenes, assets, internal, users, jobs
app/services/
  workflow.py           stage machine (create → crop → parse → review → style → mapping → scene)
  orchestrator.py       Gemini turn: context, tool loop, streaming, scene_change messages
  gemini_client.py      google-genai (Vertex AI) wrapper, retries, logging
  tools.py              tool registry: schema, allowed stages, confirmation rule, handlers
  asset_mapper.py       plan objects → catalog assets (category table, footprint fit, orientation)
  scene_builder.py      FloorPlan + style + mapping → SceneGraph (meters)
  scene_ops.py          apply / invert op batches, undo/redo, scenes/{id}
  asset_service.py      assets/{id}, Meshy start + server-side polling, promotion to the catalog
  crop_service.py       PDF render, crop, thumbnail · glb.py: GLB bounding box
app/data/         system_assets.json (41 presets, measured proportions), styles.json (palettes)
evals/            chat_tools.jsonl + run_chat_tools.py (real Gemini tool-choice eval)
```

## Develop

```bash
cp .env.example .env && python -m venv .venv && .venv/bin/pip install -r requirements.txt
gcloud auth application-default login          # Vertex AI (Gemini) with your account
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q tests            # fully mocked (in-memory Firestore/Storage/Meshy/Gemini)
.venv/bin/python -m evals.run_chat_tools       # real Gemini, target ≥ 18/20
```

Without `MESHY_POLL_QUEUE` the API polls Meshy from a background thread; without `CLOUD_TASKS_QUEUE` it calls
the parsing worker directly. `UPDATE_GOLDEN=1 pytest tests/test_scene_builder.py` refreshes the golden scene.
