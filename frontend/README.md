# SoraPlan Frontend — Authentication & Studio Login

Simple, elegant, and responsive authentication page for **SoraPlan**, built with semantic HTML, vanilla CSS (drafting blueprint aesthetics), and modern JavaScript.

## Features

- **Sign In & Account Registration**: Interactive tab switcher between Login and Sign Up.
- **Backend Connected**: Direct REST integration with `api` (`/v1/auth/login`, `/v1/auth/signup`, `/v1/auth/me`, `/v1/auth/logout`).
- **Profile & Quota Inspection**: Once authenticated, displays user details, subscription tier, and live Firestore quotas (projects, renders, 3D asset generation limits).
- **Modern Form UX**:
  - Semantic HTML5 form with proper `autocomplete` and `enterkeyhint` attributes (as recommended by modern web standards).
  - Password show / hide visibility toggle.
  - Interactive toast notifications for errors, input validation, and success events.
- **Interactive 2D Plan & Calibration**: Inspect and edit walls, furniture dimensions, rotate components, calibrate against 4 room corners and reference sketch overlay.
- **Step ② Custom Furniture Ingestion & Meshy 3D AI**:
  - Direct V4 Signed PUT upload flow to Google Cloud Storage (`soraplan-assest-dev/{user_id}/{project_id}/furniture/{file_id}.ext`).
  - Seamlessly accessible right after Interactive 2D Plan via `Upload Furniture` button in the Property Inspector empty state, or directly per-furniture piece (`📸 Photo for item`), and from project cards.
  - Multi-step animated progress tracking (Signed URL -> GCS PUT -> Asset Registration).
  - Automated Meshy AI Image-to-3D generation with standard resolution, PBR textures, and image enhancement.
  - **Interactive 3D Review Window (`3D Review` button)**:
    - Replaces raw file downloads with an in-browser WebGL 3D model inspector powered by Google's `<model-viewer>`.
    - Orbit (360° left-drag), Pan (right-click / 2-finger drag), and Zoom (mouse scroll).
    - Floating HUD toolbar with Auto-Rotate toggle, Camera Viewpoint reset, and Studio/Blueprint/Dark background switcher.
    - Soft ground contact shadows, PBR material rendering, and real-scale metric scene graph alignment.
- **Theme Support**: Dark mode & light mode toggle with localStorage persistence.
- **Glassmorphism & Blueprint Grid**: Styled with SoraPlan's architectural theme.

## How to View

You can open `index.html` directly in your browser or run a lightweight local static server:

```bash
# Using Python
cd frontend
python3 -m http.server 3000

# Or using npx
npx serve . -p 3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
Ensure your backend (`backend/api`) is running on port 8000:

```bash
cd backend/api
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```
