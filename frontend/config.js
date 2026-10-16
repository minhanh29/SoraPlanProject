// Local development defaults. deploy/deploy.sh overwrites this file in the
// hosting build with the deployed Cloud Run API URL.
window.SORAPLAN_CONFIG = {
  API_BASE_URL: "http://localhost:8000/v1",
  CATALOG_BASE_URL: "https://storage.googleapis.com/soraplan-catalog",
};
