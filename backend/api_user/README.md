# SoraPlan User API (`api_user`)

FastAPI backend service responsible for user management, authentication, and quotas for the **SoraPlan** platform, integrating directly with **Firebase Authentication** and **Cloud Firestore**.

## Features

- **Sign Up**: Creates user account in Firebase Auth and provisions initial user profile and quotas in Firestore (`users/{uid}`).
- **Login**: Authenticates email and password against Firebase Identity Toolkit, retrieving ID Token and Refresh Token, and heals user profile if needed.
- **Google Sign-In**: Verifies client-side Firebase Google ID tokens and provisions user profile.
- **Token Refresh**: Refreshes expired ID tokens via Firebase SecureToken API.
- **User Profile & Quotas**: Fetch and update user profiles, view subscription plan quotas (projects, 3D assets, renders).
- **RFC 7807 Problem Details**: Standardized error responses across all endpoints.
- **REST Wire Format**: camelCase JSON matching TypeScript schemas.

## API Endpoints

### Auth (`/v1/auth`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/v1/auth/signup` | Register new user with email & password | No |
| `POST` | `/v1/auth/login` | Login with email & password | No |
| `POST` | `/v1/auth/google` | Authenticate with client-provided Firebase Google token | No |
| `POST` | `/v1/auth/refresh` | Refresh ID token using refresh token | No |
| `GET` | `/v1/auth/me` | Get currently authenticated user profile | Bearer Token |
| `POST` | `/v1/auth/logout` | Revoke all refresh tokens for current user | Bearer Token |

### Users (`/v1/users`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/v1/users/me` | Get profile for current user | Bearer Token |
| `PATCH` | `/v1/users/me` | Update display name and/or avatar photo URL | Bearer Token |
| `GET` | `/v1/users/me/quota` | Get user quota limits and tier information | Bearer Token |
| `GET` | `/v1/users/{uid}` | Get user profile by UID | Bearer Token |

### Projects & Floor Plan Uploads (`/v1/projects`)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/v1/projects` | Create a new project (auto-generated Google Cloud ID) | Bearer Token |
| `GET` | `/v1/projects` | List all projects for authenticated user with signed URLs | Bearer Token |
| `GET` | `/v1/projects/{id}` | Get project details by ID with signed display URL | Bearer Token |
| `POST` | `/v1/projects/{id}/upload-url` | Generate V4 signed PUT upload URL & signed display URL | Bearer Token |
| `POST` | `/v1/projects/{id}/confirm-upload` | Confirm direct upload and write update to Firestore | Bearer Token |
| `DELETE` | `/v1/projects/{id}` | Delete project and remove uploaded plan from GCS | Bearer Token |

> **Single Plan Rule**: Each project accepts strictly **one** floor plan (sketch image, screenshot, or PDF). Once uploaded successfully, re-uploading to the same project is permanently blocked (HTTP 409 `PLAN_ALREADY_UPLOADED`). To upload another floor plan, users must create a new project.
>
> **Google Cloud Storage & ID Conventions**:
> - Object storage path follows: `soraplan-assest-dev/{user_id}/{project_id}/{files}`
> - Public display URLs are V4 signed GET URLs (`X-Goog-Algorithm=GOOG4-RSA-SHA256`).
> - All identifiers (`projectId`, `uploadId` / `contentId`) are generated strictly following Google Cloud Firestore ID specifications, never created locally.


### System

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check endpoint |
| `GET` | `/docs` | Interactive Swagger API documentation |
| `GET` | `/redoc` | ReDoc API documentation |

## Setup & Running Locally

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Ensure `FIREBASE_PROJECT_ID=soraplan` and `FIREBASE_WEB_API_KEY` are populated. Authentication uses Google Application Default Credentials (ADC) or a Service Account JSON path.

### 3. Run Development Server

```bash
uvicorn app.main:app --reload --port 8000
```

Access API docs at: [http://localhost:8000/docs](http://localhost:8000/docs)

### 4. Run Tests

```bash
pytest
```
