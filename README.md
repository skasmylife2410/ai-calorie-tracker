# Bocado — free AI calorie tracker (build it yourself with Claude)

Snap a photo of your food → AI tells you the calories and macros. A complete, free clone of paid apps like Cal AI, running entirely on free tiers, installable on your phone as an app.

**You don't need to know how to code.** If you have a Claude subscription ([claude.ai](https://claude.ai) or Claude Code), just paste this to Claude:

> Clone https://github.com/learnaiwithhugo/ai-calorie-tracker and follow its README to set it up and deploy it for me. Walk me through getting the API keys step by step — I'm not technical.

Claude will read this README and handle everything below for you.

---

## What you get

- 📸 **Photo → calories**: take a photo of any meal, Google Gemini estimates calories, protein, carbs, and fat per item
- ✍️ **Describe a meal**: type "chicken burrito and a coke" and it estimates it
- 🏷️ **Nutrition-label scanning**: photograph a label for exact numbers
- 📊 **Barcode scanning**: scans packaged food via Open Food Facts (3M+ products), USDA fallback
- 🔍 **Food search**: search the Open Food Facts database by name
- 🎯 **Personal targets**: onboarding calculates your calorie/macro goals (Mifflin-St Jeor BMR → TDEE → goal delta)
- 💧 Water tracking, 🔥 day streaks, 📅 history, ⭐ saved foods
- 📱 **Installable PWA**: Add to Home Screen on iPhone/Android — looks and feels like a native app
- ☁️ **Optional cloud sync** via Supabase (free tier) — otherwise data stays private in your browser
- 💸 **$0/month**: Gemini free tier + Vercel free tier + Supabase free tier

No frameworks, no build step, zero runtime npm dependencies. Vanilla JS + two small serverless functions. Your API keys stay server-side and never reach the browser.

---

## Instructions for Claude

You (Claude) are setting this app up for a non-technical user. Follow these steps in order, doing everything you can yourself and walking the user through only the parts that need their browser (creating accounts, copying keys).

### Step 0 — Prerequisites

- Node.js 18+ (`node --version`). If missing, help the user install it (macOS: `brew install node`; otherwise nodejs.org).
- Clone the repo and install dev tooling (the only npm packages are the Vercel CLI and a barcode polyfill — the app itself has zero runtime dependencies):

```bash
git clone https://github.com/learnaiwithhugo/ai-calorie-tracker.git
cd ai-calorie-tracker
npm install
```

### Step 1 — Get a Gemini API key (required, free, ~2 minutes)

Walk the user through this — it's the only required key:

1. Go to **https://aistudio.google.com/apikey** and sign in with any Google account.
2. Click **Create API key** (create it in a new project if prompted).
3. Copy the key (starts with `AIza...`).

Then create the env file:

```bash
cp .env.example .env
```

Put the key in `.env` as `GEMINI_API_KEY`. The free tier has a small daily request limit (roughly 20 photo analyses/day on the flash model, resets daily) — plenty for personal meal logging. If the user wants headroom, they can create a second key under a different Google account/project and set it as `GEMINI_API_KEY_BACKUP`; the app fails over to it automatically.

### Step 2 — Run it locally and verify

```bash
npm run dev
```

Open **http://localhost:3000**. Verify: the onboarding flow renders, and after completing it you land on the Today screen with the calorie ring. Run the test suite too:

```bash
npm test
```

Sync being "unconfigured" at this point is expected — Supabase is optional (Step 4).

### Step 3 — Personalize (30 seconds)

- In [js/api.js](js/api.js), find `OFF_USER_AGENT` near the top and replace `you@example.com` with the user's real email. (Open Food Facts asks apps to identify themselves — it's polite, not secret.)
- Ask the user to complete onboarding in the app itself (height, weight, goal) — that's how targets are calculated. No code needed.

### Step 4 — Optional: cloud sync with Supabase (free)

Skip this if the user only wants data on one device (everything works offline via localStorage). Otherwise:

1. User creates a free project at **https://supabase.com** (any name, any region).
2. In the Supabase dashboard: **SQL Editor** → paste the entire contents of [supabase/0001_snapcal_schema.sql](supabase/0001_snapcal_schema.sql) → **Run**. It creates three `snapcal_*` tables and touches nothing else.
3. In **Project Settings → API**, copy the **Project URL** → `.env` `SUPABASE_URL`, and the **`service_role` secret key** → `.env` `SUPABASE_SERVICE_ROLE_KEY`.

Security model (by design — don't "fix" it): RLS is enabled with **no policies**, so the anon key can't touch the tables at all. Only the passcode-gated serverless function `/api/sync` talks to Supabase, using the service-role key server-side. The browser never sees any Supabase credential.

### Step 5 — Set a passcode before deploying (strongly recommended)

Set `APP_TOKEN` in `.env` to any string the user picks (a 6-digit PIN is fine). Once deployed, the app prompts for this passcode on first load and sends it with every API call — without it, anyone who finds the URL could burn the user's Gemini quota and read/write their food data. Leave it blank only for local dev.

### Step 6 — Deploy to Vercel (free)

```bash
npx vercel login        # user authenticates in browser
npx vercel --prod       # accept defaults; it's a static site + /api functions
```

Then set the environment variables in production (repeat for each var in `.env` that has a value):

```bash
npx vercel env add GEMINI_API_KEY production
npx vercel env add APP_TOKEN production
# ...and GEMINI_API_KEY_BACKUP / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY if used
npx vercel --prod       # redeploy so the env vars take effect
```

(Alternatively: push the repo to the user's GitHub and import it at vercel.com — auto-deploys on every push. Env vars go in Project Settings → Environment Variables.)

Verify the deployment: open the production URL, enter the passcode, log a test meal by photo.

### Step 7 — Install it on the user's phone

- **iPhone**: open the URL in Safari → Share → **Add to Home Screen**.
- **Android**: open in Chrome → menu → **Add to Home screen / Install app**.

It launches full-screen like a native app. Done. 🎉

---

## Architecture (for Claude / the curious)

```
index.html              app shell (PWA)
manifest.webmanifest    PWA manifest
sw.js                   service worker — network-first, app-shell cache
dev-server.mjs          zero-dep local dev server (serves statics + shims the two API functions)
vercel.json             Vercel config (gemini function: 60s max duration)
api/
  gemini.js             serverless proxy to Gemini (keys server-side, primary→backup failover)
  sync.js               serverless Supabase mirror via PostgREST (service-role key server-side)
  _auth.js              shared APP_TOKEN passcode gate for both functions
js/
  app.js                boot + router
  store.js              localStorage CRUD + pub/sub — the source of truth
  sync.js               offline-first Supabase mirror (last-write-wins on updated_at, tombstone deletes)
  queue.js              background photo/text analysis queue (survives app close)
  api.js                Open Food Facts / USDA / Gemini clients, USDA grounding of AI estimates
  nutrition.js          BMR / TDEE / macro-target math
  resize.js             client-side image downscale before upload
  ui/                   18 screen/component modules (today, scan, results, history, onboarding, …)
  README-CORE.md        module-by-module API reference
css/                    hand-written design system (theme.css tokens + app.css)
vendor/                 self-hosted barcode-detector polyfill + zbar-wasm (no CDN calls)
supabase/               0001_snapcal_schema.sql — the entire DB schema, run once
tests/                  node --test suites for core logic and sync merge
```

Key properties:

- **localStorage is the source of truth**; Supabase is a mirror, so the app is fully functional offline and without any database.
- **No secrets in the browser** — Gemini and Supabase are only ever called from the two serverless functions.
- **No build step** — edit a file, refresh the page. Trivially hackable.

## Costs & limits

| Service | Cost | Limit that matters |
|---|---|---|
| Google Gemini (free tier) | $0 | ~20 analyses/day on the flash model; add `GEMINI_API_KEY_BACKUP` to double it |
| Vercel Hobby | $0 | Far beyond personal use |
| Supabase free tier (optional) | $0 | 500 MB database — years of meals |
| Open Food Facts | $0 | Free, open database — set your contact email in the User-Agent |
| USDA FoodData Central | $0 | Ships with the public `DEMO_KEY` (rate-limited); free real key at https://fdc.nal.usda.gov/api-key-signup if needed |

## Troubleshooting

- **"Sync unconfigured"** — expected when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` aren't set. The app works fine without them.
- **401 errors from /api/...** — the passcode entered in the app doesn't match `APP_TOKEN`. Update it in the app's Profile screen, or clear site data and re-enter.
- **Photo analysis fails late in the day** — the Gemini free-tier daily quota is exhausted; it resets daily. Add a backup key (Step 1) for headroom.
- **Changed env vars but nothing happened (Vercel)** — env vars only apply on the next deploy; run `npx vercel --prod` again.
- **Barcode scanner finds nothing** — needs camera permission and decent lighting; it uses the native BarcodeDetector where available and falls back to the bundled zbar-wasm.

## License

MIT — do whatever you want with it.

---

Built by [Hugo Manning](https://x.com/hugoman225) — **Learn AI with Hugo**. I built the original as a native iOS app, then had Claude port the whole thing to this web app in a day. If you build one, tell me — I'd love to see it.
