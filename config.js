// InsiderReach API configuration.
// API_BASE = cloud-api (rewrite, usage, /v1/me)
// WEB_APP_BASE = Next.js dashboard (sign-in, billing) — optional for local dev
const INSIDERREACH_CONFIG = {
  API_BASE: "http://localhost:8080",
  WEB_APP_BASE: "http://localhost:3000",
  PRODUCTION_API_BASE: "https://api.insiderreach.com",
  PRODUCTION_WEB_APP_BASE: "https://app.insiderreach.com",
};

function getApiBase() {
  return INSIDERREACH_CONFIG.API_BASE || INSIDERREACH_CONFIG.PRODUCTION_API_BASE;
}

function getWebAppBase() {
  return INSIDERREACH_CONFIG.WEB_APP_BASE || INSIDERREACH_CONFIG.PRODUCTION_WEB_APP_BASE;
}
