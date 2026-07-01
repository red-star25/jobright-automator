# InsiderReach Web Dashboard

Next.js app for **sign-in**, account dashboard, and extension OAuth. Usage limits and billing are handled by **cloud-api** (Railway).

## Setup

1. Copy `.env.example` to `.env.local` and fill in Supabase + `CLOUD_API_URL`.
2. Run the Supabase migration in `supabase/migrations/001_initial.sql` (auth only).
3. In Supabase Auth settings, add redirect URLs:
   - `http://localhost:3000/auth/extension-callback`
   - `https://YOUR-WEB-URL/auth/extension-callback`
4. Ensure **cloud-api** on Railway has Stripe + `SUPABASE_URL` configured (see `../cloud-api/DEPLOY.md`).
5. Point the Stripe webhook at **cloud-api**: `POST https://YOUR-RAILWAY-DOMAIN/v1/stripe/webhook` (not this app).

## Development

```bash
npm install
npm run dev
```

## Architecture

| Concern | Handled by |
| -------- | ---------- |
| Sign-in (Supabase) | `web/` |
| Extension OAuth | `web/auth/*` |
| Usage / plan / rewrites | **cloud-api** `/v1/me`, `/v1/rewrite` |
| Stripe checkout / portal | **cloud-api** `/v1/stripe/*` |
| Dashboard UI | `web/` proxies to cloud-api via `/api/me` |

## Extension integration

- `config.js`: `API_BASE` → Railway cloud-api, `WEB_APP_BASE` → this app
- Extension sign-in: `chrome.identity.launchWebAuthFlow` via `/auth/extension-start`
- Cloud AI rewrites: extension → cloud-api `POST /v1/rewrite`

## Plans

Limits are enforced in cloud-api (`cloud-api/src/services/plans.ts`):

- Free: 25 Rewrite / 5 Rewrite Pro per month
- Pro: 500 Rewrite / 150 Rewrite Pro per month
