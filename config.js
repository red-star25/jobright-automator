// InsiderReach API configuration.
const INSIDERREACH_CONFIG = {
  API_BASE: "https://jobright-automator-production.up.railway.app",
  WEB_APP_BASE: "https://web-gamma-silk-53.vercel.app",
};

function getApiBase() {
  return INSIDERREACH_CONFIG.API_BASE;
}

function getWebAppBase() {
  return INSIDERREACH_CONFIG.WEB_APP_BASE;
}

function resolveAiMode(settings, fallback = "ask") {
  if (settings?.aiMode) return settings.aiMode;
  if (settings?.aiRewriteEnabled === false) return "off";
  return fallback;
}
