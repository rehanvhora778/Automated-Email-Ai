# Deploying Smart Email Agent

Backend on **Render**, frontend on **Vercel**, database and auth already on **Supabase**.

There is a chicken-and-egg problem worth knowing up front: the backend needs the
frontend's URL for CORS, and the frontend needs the backend's URL for API calls. So the
order below deploys the backend first with a placeholder, then comes back and fixes it in
step 6. Skipping that return trip is the most common reason a deployment "works" but every
request fails.

**Rough time:** 30–40 minutes, most of it waiting on builds.

---

## Before you start

You need:

- The repo pushed to GitHub (already done)
- A [Render](https://render.com) account — free tier is enough
- A [Vercel](https://vercel.com) account — free tier is enough
- Your Supabase project already set up (schema + all three migrations run)
- These four secrets to hand:

| Secret | Where it lives now |
|---|---|
| `SUPABASE_URL` | `backend/.env` |
| `SUPABASE_KEY` (service_role) | `backend/.env` |
| `MISTRAL_API_KEY` | `backend/.env` |
| Google OAuth client JSON | `backend/credentials.json` |

> **The service-role key bypasses row-level security.** It belongs only in Render's
> environment variables — never in the frontend, never in the repo.

---

## Step 1 — Deploy the backend to Render

1. Go to **https://dashboard.render.com** → **New +** → **Web Service**
2. Connect your GitHub account and pick **`Automated-Email-Ai`**
3. Fill in:

| Field | Value |
|---|---|
| **Name** | `smart-email-agent-api` (this becomes your URL) |
| **Region** | whichever is closest to you |
| **Branch** | `main` |
| **Root Directory** | `backend` |
| **Runtime** | Python 3 |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| **Instance Type** | Free |

**Root Directory must be `backend`.** Render still clones the whole repository, so
`ml/models/*.joblib` remains reachable — the classifiers resolve their path relative to the
repo root, not the working directory.

4. **Do not deploy yet.** Add the environment variables first (next step), or the first
   boot will crash on a missing `SUPABASE_URL`.

---

## Step 2 — Backend environment variables

Scroll to **Environment Variables** and add these six:

| Key | Value |
|---|---|
| `PYTHON_VERSION` | `3.11.9` |
| `SUPABASE_URL` | your project URL |
| `SUPABASE_KEY` | your **service_role** key |
| `MISTRAL_API_KEY` | your Mistral key |
| `GOOGLE_CREDENTIALS_JSON` | the **entire contents** of `backend/credentials.json`, as one line |
| `ALLOWED_ORIGINS` | `http://localhost:5173` for now — fixed in step 6 |

For `GOOGLE_CREDENTIALS_JSON`, open `backend/credentials.json`, copy everything including
the outer braces, and paste it as the value. It must stay valid JSON on a single line:

```json
{"web":{"client_id":"...","project_id":"...","client_secret":"...","redirect_uris":["..."]}}
```

This exists because `credentials.json` is gitignored and therefore absent on Render. The
backend prefers this variable and falls back to the file locally.

Now click **Create Web Service**. The first build takes 5–10 minutes — scikit-learn and
SciPy are large wheels.

When it finishes you get a URL like `https://smart-email-agent-api.onrender.com`.
**Copy it.**

### Verify the backend

```bash
curl https://smart-email-agent-api.onrender.com/
# {"message":"Email Agent Backend is Running!"}

curl https://smart-email-agent-api.onrender.com/api/v1/ai/classify/health
```

The second call should report both models as `"available": true`. If it does, the ML models
were committed and loaded correctly — the single best signal that the deploy is healthy.

---

## Step 3 — Point Google OAuth at Render

The Gmail "Link" flow redirects back to the backend, which is no longer localhost.

1. **https://console.cloud.google.com/apis/credentials?project=smart-email-agent-501013**
2. Open your OAuth 2.0 Web client
3. Under **Authorized redirect URIs**, add:
   ```
   https://smart-email-agent-api.onrender.com/api/v1/actions/callback
   ```
   Keep the existing localhost URI and the Supabase one.
4. **Save**

Then back in Render → **Environment** → add:

| Key | Value |
|---|---|
| `OAUTH_REDIRECT_URI` | `https://smart-email-agent-api.onrender.com/api/v1/actions/callback` |
| `FRONTEND_URL` | `https://automated-email-ai.vercel.app` |

Render redeploys automatically. `OAUTH_REDIRECT_URI` must match the Google entry
**character for character** — a trailing slash difference is enough to fail.

`FRONTEND_URL` is where the OAuth callback sends the browser once Google hands back the
code. Unset, it falls back to the first entry in `ALLOWED_ORIGINS`, then to localhost.

> **If `OAUTH_REDIRECT_URI` is missing**, the backend now derives the callback from
> Render's own `RENDER_EXTERNAL_URL` instead of falling back to localhost, and refuses
> to start the flow at all if it would send you somewhere unreachable. That turns the
> old silent "page not found" tab into a message naming the exact fix. The Google
> Console entry in step 3 is still required — nothing can be done server-side about a
> redirect URI Google has not been told to accept.

---

## Step 4 — Deploy the frontend to Vercel

1. **https://vercel.com/new** → import **`Automated-Email-Ai`**
2. Configure:

| Field | Value |
|---|---|
| **Framework Preset** | Vite |
| **Root Directory** | `frontend` |
| **Build Command** | `npm run build` (default) |
| **Output Directory** | `dist` (default) |

**Root Directory must be `frontend`**, or Vercel will look for `package.json` at the repo
root and fail.

3. Expand **Environment Variables** and add:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://smart-email-agent-api.onrender.com` |

Optionally also set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; without them the app
uses the values compiled into `supabaseClient.ts`.

> `VITE_*` variables are **inlined into the JavaScript bundle** at build time and are
> readable by anyone. Only the Supabase publishable (anon) key belongs here — never the
> service-role key or the Google client secret.

4. **Deploy.** You get a URL like `https://automated-email-ai.vercel.app`. **Copy it.**

---

## Step 5 — Tell Supabase about the new domain

Google sign-in redirects through Supabase, which refuses to redirect anywhere it does not
recognise.

**https://supabase.com/dashboard/project/&lt;your-ref&gt;/auth/url-configuration**

| Setting | Value |
|---|---|
| **Site URL** | `https://automated-email-ai.vercel.app` |
| **Redirect URLs** | add `https://automated-email-ai.vercel.app/**` |

The `/**` wildcard matters if you ever add routes. To keep local development working, add
`http://localhost:5173/**` as a second redirect URL.

---

## Step 6 — Close the loop on CORS

This is the step people skip.

Render → your service → **Environment** → edit `ALLOWED_ORIGINS`:

```
https://automated-email-ai.vercel.app
```

No trailing slash. For several origins, separate with commas.

To allow Vercel's per-commit preview deployments as well, add:

| Key | Value |
|---|---|
| `ALLOWED_ORIGIN_REGEX` | `https://.*\.vercel\.app` |

Render redeploys. Until this is done, the browser blocks every API call with a CORS error
even though the backend is perfectly healthy.

---

## Step 7 — Test it

Open your Vercel URL and check, in order:

1. **The login screen renders** — frontend deployed
2. **Sign up with email** → the 6-digit code arrives → verification succeeds — Supabase auth and OTP work
3. **Sign in with Google** → consent → you land in the app — OAuth and redirect URLs are right
4. **AI Tools → Threat Detection** → both cards show a live F1 score — the backend is reachable and the models loaded
5. **Paste an email into Spam Detection** → verdict appears immediately, explanation streams in — the full path works
6. **Settings → Gmail connection** shows "Connected" — the OAuth token was stored

If step 4 shows no F1 badges, the frontend cannot reach the backend: check `VITE_API_URL`
and `ALLOWED_ORIGINS`, and look at the browser console for a CORS message.

---

## Things that will surprise you

### The first request after idle takes ~50 seconds

Render's free tier spins a service down after 15 minutes without traffic, and the next
request pays for a cold start — made worse here by loading scikit-learn. Nothing is broken.

For a demo you are about to show someone, open the backend URL a minute beforehand to wake
it. A `$7/month` Starter instance removes the behaviour entirely, or a free uptime pinger
hitting `/` every 10 minutes mostly hides it.

### Memory

Measured steady state with both classifiers loaded: **~226 MB**, against the free tier's
512 MB limit. Models load lazily on first use, so idle sits lower. There is room, but adding
another large dependency could push it over.

### Supabase pauses free projects

After a week of inactivity the project pauses and every API call fails with a DNS error.
The dashboard shows a **Restore project** button. The backend already returns a clear
message for this case rather than a generic 500.

### Rebuilds are not automatic for environment variables

Changing a `VITE_*` variable in Vercel requires a **redeploy** — the value is baked into the
bundle at build time. Render restarts on its own when you change a variable.

---

## Deploying with the blueprint instead

`render.yaml` at the repo root describes the same service. In Render, choose
**New +** → **Blueprint**, select the repo, and it reads the configuration; you are prompted
for the secrets, which are marked `sync: false` so they are never stored in the repo.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| CORS error in the browser console | `ALLOWED_ORIGINS` missing your Vercel URL, or has a trailing slash |
| `classify/health` says `available: false` | The `.joblib` files were not committed — check `git ls-files ml/models` |
| Build fails: `No module named app` | Root Directory is not set to `backend` |
| Vercel build fails: no `package.json` | Root Directory is not set to `frontend` |
| `redirect_uri_mismatch` on Link Gmail | `OAUTH_REDIRECT_URI` and the Google Console entry differ |
| "Link Gmail" opens a page-not-found tab | The Render callback URL is not in Google's **Authorized redirect URIs** (step 3) |
| Settings says "missing permissions" right after linking | Pre-fix builds stored an empty scope list; re-link once and it clears |
| Google sign-in returns to localhost | Supabase **Site URL** still points at localhost |
| `Unsupported provider: provider is not enabled` | Google provider off in Supabase — see the main README |
| Confirmation email has a link, not a code | The signup template needs `{{ .Token }}` — see the main README |
| Everything 500s after a quiet week | Supabase project paused; restore it from the dashboard |
