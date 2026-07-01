// InsiderReach SaaS API configuration.
// Change API_BASE to your deployed web app URL before publishing.
const INSIDERREACH_CONFIG = {
  API_BASE: "http://localhost:3000",
  PRODUCTION_API_BASE: "https://app.insiderreach.com",
};

function getApiBase() {
  return INSIDERREACH_CONFIG.API_BASE || INSIDERREACH_CONFIG.PRODUCTION_API_BASE;
}
