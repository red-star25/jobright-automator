# Deploy InsiderReach Web Dashboard (Vercel)

The Chrome extension sign-in flow opens `WEB_APP_BASE` from the repo root [`config.js`](../config.js). Deploy this Next.js app so production sign-in works without running `npm run dev` locally.

**Cost:** Vercel Hobby is $0 for this app.

---

## Prerequisites

- Vercel account ([vercel.com](https://vercel.com))
- `.env.local` filled from `.env.example` (Supabase, Stripe, OpenAI)
- Supabase migration applied (`supabase/migrations/001_initial.sql`)
- Cloud API already on Railway (see [`cloud-api/DEPLOY.md`](../cloud-api/DEPLOY.md))

---

## One-command deploy (CLI)

From this directory:

```bash
npm install
npx vercel login          # once per machine
./scripts/deploy.sh       # sync env vars + production deploy
```

The script prints your live URL and the exact `config.js` / `manifest.json` edits.

---

## Manual deploy (Vercel dashboard)

1. [vercel.com/new](https://vercel.com/new) → Import `red-star25/jobright-automator`
2. **Root Directory:** `web`
3. **Framework:** Next.js (auto-detected)
4. Add environment variables (Production):

| Variable | Notes |
| -------- | ----- |
| `NEXT_PUBLIC_APP_URL` | Set after first deploy, e.g. `https://app.insiderreach.com` or your `*.vercel.app` URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; never expose to client |
| `OPENAI_API_KEY` | For `/api/ai/personalize` |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | From Stripe webhook for `POST /api/stripe/webhook` |
| `STRIPE_PRO_PRICE_ID` | Pro subscription price ID |

5. Deploy → copy the production URL.

---

## After deploy

### 1. Set `NEXT_PUBLIC_APP_URL` on Vercel

Redeploy after setting this to your **final** public URL (custom domain or `*.vercel.app`). Stripe checkout success/cancel URLs depend on it.

### 2. Supabase Auth redirect URLs

Supabase → **Authentication** → **URL Configuration** → **Redirect URLs**, add:

- `https://YOUR-WEB-URL/auth/extension-callback`
- `https://YOUR-WEB-URL/dashboard`

(Keep `http://localhost:3000/...` for local dev.)

### 3. Extension `config.js`

```js
const INSIDERREACH_CONFIG = {
  API_BASE: "https://jobright-automator-production.up.railway.app",
  WEB_APP_BASE: "https://YOUR-WEB-URL",
  PRODUCTION_API_BASE: "https://jobright-automator-production.up.railway.app",
  PRODUCTION_WEB_APP_BASE: "https://YOUR-WEB-URL",
};
```

Reload the extension at `chrome://extensions`.

### 4. `manifest.json` host_permissions

Add your web URL (if not already present):

```json
"https://YOUR-WEB-URL/*"
```

### 5. Railway `PUBLIC_APP_URL`

Railway → cloud-api service → Variables:

```
PUBLIC_APP_URL=https://YOUR-WEB-URL
```

Used for Stripe checkout return URLs from the extension.

### 6. Stripe webhook (web dashboard billing)

If billing goes through the **web** app (not only cloud-api), point a Stripe webhook at:

```
POST https://YOUR-WEB-URL/api/stripe/webhook
```

Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

---

## Custom domain (optional)

Vercel → Project → **Settings** → **Domains** → add `app.insiderreach.com`.

1. Add the DNS records Vercel shows (usually CNAME to `cname.vercel-dns.com`).
2. Set `NEXT_PUBLIC_APP_URL=https://app.insiderreach.com` and redeploy.
3. Update `config.js`, `manifest.json`, Supabase redirects, and Railway `PUBLIC_APP_URL` to the custom domain.

---

## Verify

```bash
curl -sI https://YOUR-WEB-URL | head -3
curl -s https://YOUR-WEB-URL/auth/sign-in | head -c 200
```

In the extension: **Options → Sign in with Cloud AI** — should open your deployed sign-in page (not localhost).

---

## Troubleshooting

| Issue | Fix |
| ----- | --- |
| Sign-in opens localhost | Update `WEB_APP_BASE` in `config.js` and reload extension |
| Extension fetch blocked | Add web URL to `manifest.json` `host_permissions` |
| OAuth redirect error | Add callback URL in Supabase redirect allowlist |
| Stripe checkout wrong return URL | Set `NEXT_PUBLIC_APP_URL` on Vercel and redeploy |
