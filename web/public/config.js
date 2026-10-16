// Local development defaults. deploy/deploy.sh overwrites this file in the
// hosting build with the deployed API URL and Firebase web config.
// The Firebase web API key for local dev comes from web/.env.local (VITE_FIREBASE_API_KEY).
window.SORAPLAN_CONFIG = {
  API_BASE_URL: "http://localhost:8000/v1",
  CATALOG_BASE_URL: "https://storage.googleapis.com/soraplan-catalog",
  FIREBASE: {
    authDomain: "soraplan.firebaseapp.com",
    projectId: "soraplan",
  },
};
