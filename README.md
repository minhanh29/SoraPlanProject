# SoraPlan

Turn a floor-plan sketch into a real-scale 3D home you can walk through and furnish.

Upload a sketch, photo, or PDF of a floor plan. Gemini reads the walls, doors, rooms, and dimension labels and
builds a scene measured in meters. Pick a style to get an AI-furnished photoreal preview, then enter the 3D
world: orbit, walk through, and move or resize furniture with live measurements and fit checks. Use the
preset catalog or upload photos of your own furniture, which are converted to 3D with Meshy.

Built for the Google AI builder hackathon.

**Authors:** Minh Anh Nguyen, Trung Tin Phan

## Stack

- **Web:** Next.js, React Three Fiber, Firebase Auth / App Hosting
- **Backend:** FastAPI (`api`, `ai-worker`), Node (`asset-worker`) on Cloud Run, Cloud Tasks, Firestore, Cloud Storage + CDN
- **AI:** Gemini 3.1 Pro / Flash, Nano Banana Pro, Gemini Live, Gemini Embeddings, Google ADK
- **3D generation:** Meshy (primary), Tripo (fallback)

## Repository layout

```
apps/web/               Next.js frontend (2D plan editor, 3D world)
services/api/           REST API
services/ai-worker/     Plan parsing, designer agent, previews, asset prep
services/asset-worker/  Image → 3D jobs, GLB normalization
packages/scene-schema/  SceneGraph / SceneOp schemas (shared contract)
catalog/                Preset furniture and materials
config/models.yaml      Model IDs and provider settings
infra/                  Terraform and Cloud Build
docs/                   Detailed technical design
```

## Documentation

- [`GEMINI.md`](GEMINI.md): high-level design and repo conventions (start here)
- [`soraplan-overview.html`](soraplan-overview.html): visual overview with architecture diagrams
- [`docs/`](docs): research, architecture, data model, AI pipeline, backend, frontend, 3D assets, infra, and roadmap

## Getting started

The code isn't in the repo yet. Development follows the milestones in
[`docs/09-roadmap-and-tasks.md`](docs/09-roadmap-and-tasks.md). Local setup will use Firebase emulators and
`docker compose` (see [`docs/05-backend.md`](docs/05-backend.md) §7 and [`docs/08-infra-devops.md`](docs/08-infra-devops.md)).

Secrets (Meshy/Tripo/Gemini keys) go in `.env.local` locally and Secret Manager in the cloud. Never commit them.
