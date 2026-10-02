# 08 — Infrastructure & DevOps (GCP)

Owner: DevOps / tech lead. IaC: Terraform in `infra/terraform`, one workspace per env (`dev`, `prod`).
Region: `asia-southeast1` (or `us-central1` if Gemini/Vertex preview models are only there — check model
availability per region; Vertex `global` endpoint for Gemini is fine).

## 1. Resources

| Resource | Name / config |
|---|---|
| Project | `soraplan-dev`, `soraplan-prod` |
| APIs enabled | run, cloudtasks, pubsub, firestore, storage, secretmanager, aiplatform, generativelanguage, cloudbuild, artifactregistry, firebase, firebasehosting, iamcredentials, logging, monitoring, cloudtrace, compute (CDN LB) |
| Firestore | Native mode, + composite & vector indexes (`infra/firestore.indexes.json`) |
| Buckets | `soraplan-uploads-{env}` (private, lifecycle 30 d), `soraplan-assets-{env}` (CDN backend bucket), `soraplan-renders-{env}` |
| CDN | External HTTPS LB + backend bucket with Cloud CDN → `cdn.soraplan.app` ; CORS for the web origin |
| Cloud Run | `api` (1 vCPU/1 GiB, min 1 in prod for latency), `ai-worker` (1 vCPU/2 GiB, timeout 30 min), `asset-worker` (2 vCPU/4 GiB, timeout 30 min) |
| Cloud Tasks queues | `plan-parse`, `design`, `render-preview`, `asset-prep`, `asset-3d`, `asset-normalize` (rates per doc 02) |
| Pub/Sub | `asset-events`, `scene-events` |
| Secret Manager | `meshy-api-key`, `tripo-api-key`, `meshy-webhook-secret`, `gemini-api-key` (dev only) |
| Firebase | Auth (Google + Anonymous), App Hosting backend for `apps/web`, security rules |
| Service accounts | `sa-api`, `sa-ai-worker`, `sa-asset-worker`, `sa-tasks-invoker` (least privilege, see §3) |
| Artifact Registry | `soraplan/containers` |
| Logging sink | AI call logs → BigQuery dataset `ai_ops` |

## 2. Environments & config
- `config/models.yaml` + env vars (`GCP_PROJECT`, `REGION`, `BUCKET_*`, `QUEUE_*`, `WORKER_URL_*`, `CDN_BASE_URL`).
- Local: Firebase emulators + `docker compose`; AI calls hit real Gemini (dev key) unless `AI_MODE=fixtures`
  (replays recorded responses — fast, free tests & offline demo fallback).

## 3. IAM (least privilege)
| SA | Roles |
|---|---|
| sa-api | `datastore.user`, `storage.objectAdmin` on uploads (signed URLs via `iam.serviceAccountTokenCreator` on self), `cloudtasks.enqueuer`, `aiplatform.user` (Live token minting) |
| sa-ai-worker | `datastore.user`, `storage.objectAdmin` (uploads read, renders/assets write), `aiplatform.user`, `cloudtasks.enqueuer` |
| sa-asset-worker | `datastore.user`, `storage.objectAdmin` (assets), `secretmanager.secretAccessor` (meshy/tripo), `cloudtasks.enqueuer`, `pubsub.publisher` |
| sa-tasks-invoker | `run.invoker` on workers (OIDC tokens for Cloud Tasks) |

Workers are `--no-allow-unauthenticated`; api is public (auth in app); `/internal/webhooks/meshy` checks the secret.

## 4. CI/CD (Cloud Build)
- Monorepo with path filters. On PR: lint, typecheck, unit tests, schema codegen check (fails if generated types
  are stale), Playwright smoke against emulators.
- On merge to `main`: build images → Artifact Registry → deploy to `dev` (Cloud Run revisions with tags) →
  smoke tests → manual approval → `prod` with traffic split 10% → 100%.
- Web: Firebase App Hosting auto-deploys `apps/web` from `main`.
- Terraform plan on PR, apply on merge (infra changes only).

## 5. Observability
- Structured JSON logs with `requestId`, `jobId`, `uid`, `projectId` (trace correlation via `X-Cloud-Trace-Context`).
- Dashboards: job throughput/latency per type, job failure rate, provider latency & error rate, Gemini tokens & est.
  cost per day, Cloud Run instances, CDN hit ratio.
- Alerts: job failure rate > 10% (15 min), Meshy error rate > 20%, queue backlog > 500, budget 50/80/100%.
- Error Reporting for both Python and Node; web errors via Firebase Crashlytics-for-web alternative → Sentry optional.

## 6. Budget guardrails
- GCP budget alerts; per-user quotas (doc 05 §6); Cloud Tasks max rates cap provider spend velocity.
- Meshy: separate API key per env; dev uses test mode.
- Kill switch flags in Firestore `config/flags` (`disable3dGen`, `forceDraftRenders`) read by workers (cached 60 s).

## 7. Disaster recovery
- Firestore PITR enabled (7 days) + daily export to GCS. Assets are reproducible from raw GLBs in `raw/`.
