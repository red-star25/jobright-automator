#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.local}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy .env.example and fill in values." >&2
  exit 1
fi

if ! npx vercel whoami >/dev/null 2>&1; then
  echo "Not logged in to Vercel. Run: npx vercel login" >&2
  exit 1
fi

echo "==> Linking Vercel project (web/) if needed..."
npx vercel link --yes 2>/dev/null || npx vercel link

echo "==> Syncing environment variables from $ENV_FILE..."
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  key="${line%%=*}"
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  [[ -z "$key" ]] && continue
  [[ "$key" == VERCEL_* ]] && continue
  printf '%s' "$value" | npx vercel env rm "$key" production --yes 2>/dev/null || true
  printf '%s' "$value" | npx vercel env add "$key" production
done < "$ENV_FILE"

echo "==> Deploying to production..."
DEPLOY_OUTPUT="$(npx vercel deploy --prod --yes 2>&1 | tee /dev/stderr)"
DEPLOY_URL="$(echo "$DEPLOY_OUTPUT" | grep -E 'Aliased[[:space:]]+' | sed 's/.*Aliased[[:space:]]*//' | tail -1)"

if [[ -z "${DEPLOY_URL:-}" ]]; then
  DEPLOY_URL="$(echo "$DEPLOY_OUTPUT" | grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)"
fi

if [[ -z "${DEPLOY_URL:-}" ]]; then
  DEPLOY_URL="$(npx vercel ls --prod 2>/dev/null | awk '/https/ {print $2; exit}')"
fi

if [[ -z "${DEPLOY_URL:-}" ]]; then
  echo "Deploy finished but could not detect URL. Check: npx vercel ls" >&2
  exit 1
fi

echo ""
echo "==> Production URL: $DEPLOY_URL"
echo ""
echo "Update NEXT_PUBLIC_APP_URL on Vercel to this URL (or your custom domain), then redeploy."
echo ""
echo "Update ../config.js:"
echo "  WEB_APP_BASE: \"$DEPLOY_URL\","
echo "  PRODUCTION_WEB_APP_BASE: \"$DEPLOY_URL\","
echo ""
echo "Add to ../manifest.json host_permissions:"
echo "  \"$DEPLOY_URL/*\""
echo ""
echo "Supabase redirect URL:"
echo "  $DEPLOY_URL/auth/extension-callback"
