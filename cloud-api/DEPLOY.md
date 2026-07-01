# Deploy InsiderReach Cloud API

**Recommended stack (cheapest reliable setup):**


| Piece      | Service                              | Cost (typical) |
| ---------- | ------------------------------------ | -------------- |
| PostgreSQL | [Neon](https://neon.tech) free tier  | **$0**         |
| Node API   | [Railway](https://railway.app) Hobby | **~$5/mo**     |


Why this combo:

- **Neon** — free Postgres (512 MB–1 GB), no sleep, good for usage counters + cache
- **Railway** — always-on API (required for the Chrome extension), simple GitHub deploy, auto `PORT`
- Avoid **Render free** for the API — it sleeps after inactivity and extension calls will fail or lag

Alternative all-in-one: Railway Postgres + API in one project (~$8–12/mo, one dashboard).

---

## Step 1 — Create Neon database (5 min)

1. Sign up at [neon.tech](https://neon.tech)
2. Create project → name it `insiderreach`
3. Copy the **pooled connection string** (PostgreSQL)
4. Append `?sslmode=require` if not already present

Example:

```
postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

1. Run migration once from your laptop:

```bash
cd cloud-api
DATABASE_URL="postgresql://..." npm run migrate
```

---

## Step 2 — Deploy API to Railway (10 min)

1. Push this repo to GitHub (if not already)
2. Sign up at [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Select your repo
4. **Settings** → set **Root Directory** to `cloud-api`
5. Railway detects the `Dockerfile` via `railway.toml`

### Environment variables (Railway → Variables)


| Variable            | Value                                               |
| ------------------- | --------------------------------------------------- |
| `DATABASE_URL`      | Neon connection string                              |
| `OPENAI_API_KEY`    | Your OpenAI key                                     |
| `JWT_SECRET`        | Random 32+ char string                              |
| `DEV_AUTH_TOKEN`    | Strong random token (extension auth until sign-in) |
| `DEV_USER_PLAN`     | `free`                                              |
| `PORT`              | Leave unset (Railway injects it)                    |
| `SUPABASE_JWT_SECRET` | Optional — Supabase project JWT secret (Settings → API) |
| `STRIPE_SECRET_KEY` | Optional — Stripe secret key (`sk_live_...` or test) |
| `STRIPE_WEBHOOK_SECRET` | Optional — from Stripe webhook endpoint |
| `STRIPE_PRO_PRICE_ID` | Optional — Stripe Price ID for Pro subscription |
| `PUBLIC_APP_URL`    | Optional — success/cancel URLs for checkout (default `https://app.insiderreach.com`) |


1. **Settings** → **Networking** → **Generate Domain**
  You’ll get something like: `https://insiderreach-api-production.up.railway.app`
2. Verify:

```bash
curl https://YOUR-RAILWAY-DOMAIN/health
```

---

## Step 3 — Point the extension at production

1. Edit `[config.js](../config.js)`:

```js
const INSIDERREACH_CONFIG = {
  API_BASE: "https://YOUR-RAILWAY-DOMAIN.up.railway.app",
  WEB_APP_BASE: "http://localhost:3000", // or Vercel URL later
  PRODUCTION_API_BASE: "https://YOUR-RAILWAY-DOMAIN.up.railway.app",
  PRODUCTION_WEB_APP_BASE: "https://app.insiderreach.com",
};
```

1. Edit `[manifest.json](../manifest.json)` — add to `host_permissions`:

```json
"https://YOUR-RAILWAY-DOMAIN.up.railway.app/*"
```

1. Reload extension at `chrome://extensions`
2. Options → paste the **same** `DEV_AUTH_TOKEN` you set on Railway → Save
3. Test Rewrite on Jobright

---

## Step 4 — JWT sessions + Stripe (optional)

After the API is live, enable production auth and billing:

### JWT session exchange

The extension exchanges your `DEV_AUTH_TOKEN` (or a Supabase access token) for a **7-day InsiderReach JWT** via `POST /v1/auth/session`. No extra Railway config needed beyond `JWT_SECRET`.

To accept Supabase sign-in tokens from the `web/` dashboard, add:

| Variable | Where to find it |
| -------- | ---------------- |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret |

### Stripe Pro checkout

1. Create a **Pro** subscription Price in [Stripe Dashboard](https://dashboard.stripe.com/products)
2. Add Railway variables: `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`
3. Create a Stripe **Webhook** endpoint:
   - URL: `https://YOUR-RAILWAY-DOMAIN/v1/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy the webhook signing secret → Railway `STRIPE_WEBHOOK_SECRET`
5. Set `PUBLIC_APP_URL` to your dashboard URL (where users land after checkout)

Test checkout from the extension: **Options → Upgrade to Pro**.

Verify session exchange:

```bash
curl -X POST https://YOUR-RAILWAY-DOMAIN/v1/auth/session \
  -H "Authorization: Bearer YOUR-DEV-AUTH-TOKEN"
```

---

## Step 5 — Lock down before public launch

- [ ] Generate a new `DEV_AUTH_TOKEN` for production (not the local dev one)
- [ ] Never commit `.env` or tokens to git
- [ ] Rotate `JWT_SECRET` if ever exposed
- [ ] Add custom domain later (e.g. `api.insiderreach.com`) in Railway → Custom Domain

---

## Troubleshooting


| Issue                               | Fix                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------- |
| **Healthcheck failure** on deploy   | See checklist below — usually missing env vars, wrong `PORT`, or bad `DATABASE_URL` |
| `Failed to start server` on Railway | Check `DATABASE_URL` and Neon IP allowlist (Neon allows all by default) |
| Extension 401                       | Token in Options must match Railway `DEV_AUTH_TOKEN` exactly            |
| Extension blocked fetch             | Add Railway URL to `manifest.json` host_permissions and reload          |
| OpenAI 502                          | Verify `OPENAI_API_KEY` on Railway                                      |

### Healthcheck failure checklist

1. **Railway → Deployments → View logs** — look for `Missing or invalid environment variables` or `Database warmup failed`.
2. **Do not set `PORT`** in Railway Variables (delete it if present). Railway injects `PORT` automatically; hardcoding `8080` breaks routing.
3. **Required variables** must all be set: `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET` (8+ chars), `DEV_AUTH_TOKEN` (8+ chars), `DEV_USER_PLAN`.
4. **`DATABASE_URL`** — use Neon’s **pooled** connection string with `?sslmode=require` appended.
5. Run migration once from your laptop (Step 1) before or after first deploy: `DATABASE_URL="..." npm run migrate`.
6. After redeploy, verify: `curl https://YOUR-RAILWAY-DOMAIN/health`


---

## Cost estimate


| Stage                         | Monthly                  |
| ----------------------------- | ------------------------ |
| Dev (local Postgres)          | $0                       |
| Prod Neon + Railway           | **~$5** (+ OpenAI usage) |
| + Vercel for `web/` dashboard | +$0 on hobby             |


OpenAI is pay-as-you-go (~$0.01–0.05 per rewrite with gpt-4o-mini).