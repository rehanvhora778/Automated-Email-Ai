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
- Your Supabase project already set up and its SQL run — a brand new project needs
  `database/setup.sql` and nothing else; an existing one needs `database/schema.sql`
  followed by migrations `002`, `003`, `004` and `005`, in order
- These four secrets to hand:

| Secret | Where it lives now |
|---|---|
| `SUPABASE_URL` | `backend/.env` |
| `SUPABASE_KEY` (service_role) | `backend/.env` |
| `MISTRAL_API_KEY` | `backend/.env` |
| Google OAuth client JSON | `backend/credentials.json` |

> **The service-role key bypasses row-level security.** It belongs only in Render's
> environment variables — never in the frontend, never in the repo.

If the Supabase project has been idle for a while, confirm it is still there before you
spend time on anything else — free projects pause, and paused ones are eventually deleted.
See **Recovering a paused or deleted Supabase project** near the end of this document.

---

## Step 1 — Deploy the backend to Render

1. Go to **https://dashboard.render.com** → **New +** → **Web Service**
2. Connect your GitHub account and pick **`Automated-Email-Ai`**
3. Fill in:

| Field | Value |
|---|---|
| **Name** | `automated-email-ai` (this becomes your URL) |
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

Scroll to **Environment Variables** and add:

| Key | Value |
|---|---|
| `PYTHON_VERSION` | `3.11.9` |
| `SUPABASE_URL` | your project URL |
| `SUPABASE_KEY` | your **service_role** key |
| `MISTRAL_API_KEY` | your Mistral key |
| `GOOGLE_CREDENTIALS_JSON` | the **entire contents** of `backend/credentials.json`, as one line |
| `ALLOWED_ORIGINS` | `http://localhost:5173` for now — fixed in step 6 |
| `BREVO_API_KEY` | your `xkeysib-…` key — this is what mails the signup and reset codes |
| `MAIL_FROM` | the sender address you verified with Brevo |
| `MAIL_GMAIL_PROFILE_ID` | *optional* — the `profiles.id` whose linked Gmail sends system mail when no Brevo or Resend key is present |

`OAUTH_REDIRECT_URI` and `FRONTEND_URL` are required too, but both name URLs that do not
exist yet, so they are added in step 3.

The mail variables are what make email sign-up work at all: the verification codes are
issued and sent by this backend rather than by Supabase. Without them the signup screen
asks for a code that never arrives. `MAIL_FROM_NAME`, `RESEND_API_KEY` and the `SMTP_*`
alternatives are described in `backend/.env.example` and in the README's step 5; Render
blocks outbound SMTP, so an HTTP provider is the only one that works here.

For `GOOGLE_CREDENTIALS_JSON`, open `backend/credentials.json`, copy everything including
the outer braces, and paste it as the value. It must stay valid JSON on a single line:

```json
{"web":{"client_id":"...","project_id":"...","client_secret":"...","redirect_uris":["..."]}}
```

This exists because `credentials.json` is gitignored and therefore absent on Render. The
backend prefers this variable and falls back to the file locally.

Now click **Create Web Service**. The first build takes 5–10 minutes — scikit-learn and
SciPy are large wheels.

When it finishes you get a URL built from the service name — for this deployment,
`https://automated-email-ai.onrender.com`. **Copy it.**

### Verify the backend

```bash
curl https://automated-email-ai.onrender.com/
# {"message":"Email Agent Backend is Running!"}

curl https://automated-email-ai.onrender.com/api/v1/ai/classify/health
```

The second call should report both models as `"available": true`. If it does, the ML models
were committed and loaded correctly — the single best signal that the deploy is healthy.

---

## Step 3 — Point Google OAuth at Render

The Gmail "Link" flow redirects back to the backend, which is no longer localhost.

1. **https://console.cloud.google.com/apis/credentials?project=smart-email-agent-501013**
2. Open your OAuth 2.0 Web client — client ID
   `1037638774796-j9a77ss8ua9episgc8hfsa29g1pek3mf.apps.googleusercontent.com`
3. Under **Authorized redirect URIs**, make sure **all three** of these are present, then
   **Save**:

| URI | Who sends the browser here |
|---|---|
| `https://automated-email-ai.onrender.com/api/v1/actions/callback` | this backend, at the end of **Link Gmail** |
| `https://<your-supabase-ref>.supabase.co/auth/v1/callback` | Supabase's own Google provider, behind **Continue with Google** |
| `http://localhost:8000/api/v1/actions/callback` | **Link Gmail** while working locally |

The first two differ because there are genuinely two OAuth flows sharing one Google
client. **Link Gmail** is run by this backend, which asks for the Gmail scopes and keeps
the refresh token itself, so Google must return to the backend. **Continue with Google**
is run by Supabase, which asks only for sign-in and performs its own code exchange, so
Google must return to Supabase. Removing either URI breaks exactly one of the two buttons
and leaves the other working, which is why the symptom is usually misread.

> **Publishing status matters more than it looks.** While the OAuth app is in **Testing**,
> Google expires every refresh token after **7 days**, and only accounts on the test-user
> list can grant the Gmail scopes at all. That is almost always what is behind "it worked
> last week" — the token did not break, it aged out. **In production** removes both limits.
> The app remains unverified either way, which only affects the warning screen shown when
> linking Gmail.

Then back in Render → **Environment** → add:

| Key | Value |
|---|---|
| `OAUTH_REDIRECT_URI` | `https://automated-email-ai.onrender.com/api/v1/actions/callback` |
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

3. Expand **Environment Variables** and add all three:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://automated-email-ai.onrender.com` |
| `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your project's **publishable (anon)** key |

All three are required. The Supabase pair has no fallback compiled into the source any
more, so a build missing them produces a frontend that cannot sign anyone in.

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

### Supabase pauses free projects, and then deletes them

After about a week of inactivity the project pauses and every API call fails. A paused
project can be restored from the dashboard; one left paused for about 90 days is removed
outright and cannot be. The next section covers telling the two apart and recovering from
either.

### Rebuilds are not automatic for environment variables

Changing a `VITE_*` variable in Vercel requires a **redeploy** — the value is baked into the
bundle at build time. Render restarts on its own when you change a variable.

---

## Recovering a paused or deleted Supabase project

Both states look the same from the app — everything fails at once — but only one of them
can be undone from the dashboard, so establish which you are in before changing anything:

```bash
nslookup <your-project-ref>.supabase.co
```

| What you get back | State | What to do |
|---|---|---|
| An address, and API calls return an HTTP error | **Paused** | Supabase dashboard → **Restore project**, wait a minute, carry on |
| `NXDOMAIN` / "can't find" — the name no longer resolves | **Deleted** | The project is gone for good. Create a new one and follow the list below |

A new project gets a **new ref, a new anon key and a new service_role key**. None of them
carry over, and the old values are written down in more places than is obvious, so work
through all of these — in this order, because each step depends on the one before:

1. **Supabase → SQL Editor** — run `database/setup.sql`. It is `schema.sql` plus every
   migration consolidated into one paste, which is exactly what a fresh project needs.
2. **Render → Environment** — set `SUPABASE_URL` to the new project URL and `SUPABASE_KEY`
   to the new **service_role** key. Render redeploys by itself.
3. **Vercel → Settings → Environment Variables** — set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` to the new project URL and **anon** key.
4. **Vercel → Deployments → Redeploy.** Do not skip this. `VITE_*` values are inlined into
   the bundle at build time, so until the frontend is rebuilt it keeps calling the deleted
   project no matter how correct the dashboard looks.
5. **Google Cloud Console → Credentials → your OAuth client** — add
   `https://<new-ref>.supabase.co/auth/v1/callback` to the authorized redirect URIs. The
   old ref's entry can be deleted.
6. **Supabase → Authentication → Sign In / Providers → Google** — enable it and paste the
   same client ID and secret as before; provider settings do not survive the project.
7. **Supabase → Authentication → URL Configuration** — set the Site URL and the redirect
   URLs again, exactly as **Step 5** of the walkthrough describes.

Accounts do not survive this either: `auth.users` lived in the deleted project. Everyone
signs up again and re-links Gmail. Nothing on the Render or Google side needs recreating
beyond the two entries named above.

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
| Settings says "missing permissions" right after linking | The stored grant records no scopes — link once more and the consent writes them |
| The app shows "This deployment isn't configured yet" | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were missing from the build. Set them in Vercel and **redeploy** |
| "That Gmail link was not started in this browser" | The consent was finished somewhere other than the tab that began it — start Link Gmail again and stay in the same tab. A link someone else sends you will always say this |
| "This link request is no longer valid" | The attempt expired (15 minutes) or was already used. Press Link Gmail again |
| Google sign-in returns to localhost | Supabase **Site URL** still points at localhost |
| `Unsupported provider: provider is not enabled` | Google provider off in Supabase — see the main README |
| Confirmation email has a link, not a code | The signup template needs `{{ .Token }}` — see the main README |
| Everything 500s after a quiet week | Supabase project paused — or deleted, if its ref no longer resolves. See **Recovering a paused or deleted Supabase project** |
| Gmail worked last week, now asks to re-link | The Google app is in **Testing**, where refresh tokens expire after 7 days (step 3) |
| Sign-in works but Link Gmail fails, or the reverse | Only one of the two redirect URIs is registered on the Google client (step 3) |
