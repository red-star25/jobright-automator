# InsiderReach Web (SaaS backend)

Next.js App Router backend for Cloud AI, accounts, usage limits, and Stripe billing.

## Setup

1. Copy `.env.example` to `.env.local` and fill in values.
2. Run the Supabase migration in `supabase/migrations/001_initial.sql`.
3. In Supabase Auth settings, add redirect URLs:
   - `http://localhost:3000/auth/extension-callback`
   - `https://app.insiderreach.com/auth/extension-callback` (production)
4. Create a Stripe Pro price and set `STRIPE_PRO_PRICE_ID`.
5. Configure the Stripe webhook to `POST /api/stripe/webhook`.

## Development

```bash
npm install
npm run dev
```

## Extension integration

- Set `API_BASE` in the extension's `config.js` to your deployed web app URL.
- Extension sign-in uses `chrome.identity.launchWebAuthFlow` via `/auth/extension-start`.
- Cloud AI calls `POST /api/ai/personalize` with the Supabase access token.

## Plans

Limits are defined in `lib/billing/plans.ts`:

- Free: 25 Rewrite / 5 Rewrite Pro per month
- Pro: 500 Rewrite / 150 Rewrite Pro per month
