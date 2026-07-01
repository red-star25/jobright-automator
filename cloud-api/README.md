# InsiderReach Cloud API

Standalone TypeScript Fastify backend for InsiderReach Cloud AI: OpenAI rewrites, usage limits, response caching, and usage event logging.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (local, Supabase, Neon, or Railway)

## Setup

```bash
cd cloud-api
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | yes | Server-side OpenAI key |
| `JWT_SECRET` | yes | Reserved for future JWT auth |
| `DEV_AUTH_TOKEN` | yes | Bearer token for local testing |
| `DEV_USER_PLAN` | no | `free` (default) or `pro` |
| `STRIPE_SECRET_KEY` | no | Loaded when present; billing routes not implemented yet |
| `ALLOWED_EXTENSION_ORIGINS` | no | Comma-separated CORS origins |

Create the database and run migrations:

```bash
createdb insiderreach   # if needed
npm run migrate
```

Start the server:

```bash
npm run dev      # development with hot reload
npm run build && npm start   # production
```

Default port: **8080**

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | no | Health check |
| GET | `/v1/me` | Bearer | Plan + monthly usage |
| POST | `/v1/rewrite` | Bearer | AI rewrite / rewritePro |
| POST | `/v1/usage/events` | Bearer | Client telemetry |

## Example curl requests

Set your dev token:

```bash
export DEV_AUTH_TOKEN="dev-token-change-me"
export API="http://localhost:8080"
```

**Health**

```bash
curl "$API/health"
```

**Current user + usage**

```bash
curl -H "Authorization: Bearer $DEV_AUTH_TOKEN" "$API/v1/me"
```

**Rewrite (email)**

```bash
curl -X POST "$API/v1/rewrite" \
  -H "Authorization: Bearer $DEV_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "rewrite",
    "channel": "email",
    "tone": "Professional",
    "originalMessage": "Hi Alex, I saw the software engineer role at Acme and would love a referral if you are open to it. Thanks, Dhruv",
    "extensionVersion": "0.3.0"
  }'
```

**Rewrite Pro (requires readable resumeText)**

```bash
curl -X POST "$API/v1/rewrite" \
  -H "Authorization: Bearer $DEV_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "rewritePro",
    "channel": "email",
    "tone": "Professional",
    "originalMessage": "Hi Alex, I am interested in the backend role.",
    "personName": "Alex",
    "company": "Acme",
    "jobTitle": "Software Engineer",
    "jobContext": {
      "responsibilities": ["Build APIs in Node.js", "Work with PostgreSQL"],
      "required": ["2+ years backend experience", "TypeScript"],
      "matchedSkills": ["Node.js", "PostgreSQL"]
    },
    "resumeText": "...(paste clean resume text, 250+ chars)...",
    "extensionVersion": "0.3.0"
  }'
```

**LinkedIn rewrite (200 char default)**

```bash
curl -X POST "$API/v1/rewrite" \
  -H "Authorization: Bearer $DEV_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "rewrite",
    "channel": "linkedin",
    "tone": "Concise",
    "maxChars": 200,
    "originalMessage": "Hi Alex, I applied to the SWE role and would appreciate a referral.",
    "extensionVersion": "0.3.0"
  }'
```

**Usage event**

```bash
curl -X POST "$API/v1/usage/events" \
  -H "Authorization: Bearer $DEV_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "rewrite_accepted",
    "mode": "rewrite",
    "channel": "email",
    "extensionVersion": "0.3.0",
    "metadata": { "cached": false }
  }'
```

## Plan limits

| Plan | Rewrite / month | Rewrite Pro / month |
|------|-----------------|---------------------|
| Free | 25 | 5 |
| Pro | 500 | 150 |

Set `DEV_USER_PLAN=pro` in `.env` to test Pro limits locally.

## Security notes

- Never log full `originalMessage`, `resumeText`, or Bearer tokens.
- Cache keys hash resume content instead of storing raw resume text in the key.
- JWT auth is stubbed; use `DEV_AUTH_TOKEN` until JWT issuance is added.

## Extension integration

The InsiderReach extension is wired to this API (v0.3.1+):

1. [`config.js`](../config.js): `API_BASE` → `http://localhost:8080`, `WEB_APP_BASE` → `http://localhost:3000` (dashboard/sign-in)
2. Options → paste `DEV_AUTH_TOKEN` from this folder's `.env` → Save (auto-selects Cloud AI)
3. Options → AI provider → **Cloud (InsiderReach)**
4. Reload extension at `chrome://extensions`
5. Run a Jobright page with AI mode **Ask every time** → click **Rewrite**

The Next.js app in `web/` is optional for local dev (billing dashboard + Supabase sign-in).
