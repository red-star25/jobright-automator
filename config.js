// InsiderReach API configuration.
// API_BASE = cloud-api (rewrite, usage, /v1/me)
// WEB_APP_BASE = Next.js dashboard (sign-in, billing) — optional for local dev
//
// LOCAL DEV: keep API_BASE on localhost:8080
// PRODUCTION: set API_BASE to your Railway URL (see cloud-api/DEPLOY.md)
const INSIDERREACH_CONFIG = {
  API_BASE: "https://jobright-automator-production.up.railway.app",
  WEB_APP_BASE: "https://web-gamma-silk-53.vercel.app",
  PRODUCTION_API_BASE: "https://jobright-automator-production.up.railway.app",
  PRODUCTION_WEB_APP_BASE: "https://web-gamma-silk-53.vercel.app",
};

function getApiBase() {
  return INSIDERREACH_CONFIG.API_BASE || INSIDERREACH_CONFIG.PRODUCTION_API_BASE;
}

function getWebAppBase() {
  return INSIDERREACH_CONFIG.WEB_APP_BASE || INSIDERREACH_CONFIG.PRODUCTION_WEB_APP_BASE;
}
