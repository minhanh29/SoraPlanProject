# SoraPlan Frontend — Authentication & Studio Login

Simple, elegant, and responsive authentication page for **SoraPlan**, built with semantic HTML, vanilla CSS (drafting blueprint aesthetics), and modern JavaScript.

## Features

- **Sign In & Account Registration**: Interactive tab switcher between Login and Sign Up.
- **Backend Connected**: Direct REST integration with `api_user` (`/v1/auth/login`, `/v1/auth/signup`, `/v1/auth/me`, `/v1/auth/logout`).
- **Profile & Quota Inspection**: Once authenticated, displays user details, subscription tier, and live Firestore quotas (projects, renders, 3D asset generation limits).
- **Modern Form UX**:
  - Semantic HTML5 form with proper `autocomplete` and `enterkeyhint` attributes (as recommended by modern web standards).
  - Password show / hide visibility toggle.
  - Interactive toast notifications for errors, input validation, and success events.
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
Ensure your backend (`backend/api_user`) is running on port 8000:

```bash
cd backend/api_user
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```
