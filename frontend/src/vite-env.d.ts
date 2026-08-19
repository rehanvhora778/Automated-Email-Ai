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
 * All three are optional: they fall back to local development defaults, so a
 * fresh clone runs with no .env file at all.
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
