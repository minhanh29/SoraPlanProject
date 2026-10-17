// Local development defaults. deploy/deploy.sh overwrites this file in the
// hosting build with the deployed API URL and Firebase web config.
// The Firebase web API key for local dev comes from web/.env.local (VITE_FIREBASE_API_KEY).
// Dev talks to the deployed Cloud Run API (it allows localhost:5173 in CORS_ORIGINS); to use a local
// API instead, set VITE_API_BASE_URL=http://localhost:8000/v1 in web/.env.local.
window.SORAPLAN_CONFIG = {
  API_BASE_URL: "https://soraplan-api-va4xv7fowq-as.a.run.app/v1",
  CATALOG_BASE_URL: "https://storage.googleapis.com/soraplan-catalog",
  FIREBASE: {
    authDomain: "soraplan.firebaseapp.com",
    projectId: "soraplan",
  },
};
