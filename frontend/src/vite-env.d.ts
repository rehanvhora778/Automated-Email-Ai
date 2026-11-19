/// <reference types="vite/client" />

/**
 * Build-time configuration.
 *
 * Vite inlines anything prefixed `VITE_` into the bundle, so these are public
 * by definition — never put a service-role key or client secret here. The
 * Supabase values below are the publishable (anon) key and project URL, which
 * are designed to be shipped to the browser and are guarded by row-level
 * security.
 *
 * VITE_API_URL is optional — it falls back to http://localhost:8000, so a
 * fresh clone runs against a local backend with no .env file. The two Supabase
 * values are required: nothing is compiled in as a fallback, because a stale
 * literal for a project that no longer exists fails silently, and a build
 * without them renders a configuration notice instead of the app.
 */
interface ImportMetaEnv {
  /** Backend base URL, e.g. https://your-api.onrender.com */
  readonly VITE_API_URL?: string;
  /** Supabase project URL, e.g. https://abcdef.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
