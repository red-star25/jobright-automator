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
| `DEV_AUTH_TOKEN`    | Strong random token (your extension auth until JWT) |
| `DEV_USER_PLAN`     | `free`                                              |
| `PORT`              | Leave unset (Railway injects it)                    |
| `STRIPE_SECRET_KEY` | Optional, for later                                 |


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

## Step 4 — Lock down before public launch

- [ ] Generate a new `DEV_AUTH_TOKEN` for production (not the local dev one)
- [ ] Never commit `.env` or tokens to git
- [ ] Implement JWT auth and remove dev token from Options UI
- [ ] Add custom domain later (e.g. `api.insiderreach.com`) in Railway → Custom Domain

---

## Troubleshooting


| Issue                               | Fix                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `Failed to start server` on Railway | Check `DATABASE_URL` and Neon IP allowlist (Neon allows all by default) |
| Extension 401                       | Token in Options must match Railway `DEV_AUTH_TOKEN` exactly            |
| Extension blocked fetch             | Add Railway URL to `manifest.json` host_permissions and reload          |
| OpenAI 502                          | Verify `OPENAI_API_KEY` on Railway                                      |


---

## Cost estimate


| Stage                         | Monthly                  |
| ----------------------------- | ------------------------ |
| Dev (local Postgres)          | $0                       |
| Prod Neon + Railway           | **~$5** (+ OpenAI usage) |
| + Vercel for `web/` dashboard | +$0 on hobby             |


OpenAI is pay-as-you-go (~$0.01–0.05 per rewrite with gpt-4o-mini).