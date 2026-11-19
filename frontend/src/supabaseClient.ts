import { createClient } from '@supabase/supabase-js';

/**
 * Supabase browser client.
 *
 * The URL and publishable (anon) key are safe to ship — they are guarded by
 * row-level security, and the service-role key never leaves the backend. They
 * come from the environment and nowhere else: a project that is torn down
 * takes its hostname with it, and a literal baked into this file keeps every
 * auth call pointing at a host that no longer resolves, with nothing anywhere
 * to say why. An unset variable is loud; a stale default is silent.
 */
const RAW_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';

/** `googleAuth.ts` appends "/auth/v1/settings", which a trailing slash doubles. */
export const supabaseUrl = RAW_SUPABASE_URL.replace(/\/+$/, '');

export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * Why authentication cannot work here, or null when both values are present.
 *
 * Reported rather than thrown. Throwing at module load runs before React
 * mounts, so the visitor gets a blank page with a stack trace instead of the
 * app's own error screen, and `npm run dev` on a fresh clone dies on the first
 * request. Callers that have somewhere to show it can render this string.
 */
export const supabaseConfigError: string | null = !supabaseUrl && !supabaseAnonKey
  ? 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both unset.'
  : !supabaseUrl
    ? 'VITE_SUPABASE_URL is unset.'
    : !supabaseAnonKey
      ? 'VITE_SUPABASE_ANON_KEY is unset.'
      : null;

if (supabaseConfigError) {
  console.error(
    `[config] ${supabaseConfigError} Sign-in, sign-up and every profile read will fail ` +
      'until both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in the hosting ' +
      'environment (Vercel -> Settings -> Environment Variables). Setting them is not ' +
      'enough on its own: VITE_ values are inlined at build time, so the deployment must ' +
      'be REDEPLOYED afterwards or the already-built bundle keeps the old values.'
  );
}

// createClient rejects an empty URL or key by throwing, which would take the
// whole page down for exactly the reason the check above avoids. The
// placeholders keep it constructible so the app still renders and each call
// fails on its own; supabaseConfigError is what explains it.
export const supabase = createClient(
  supabaseUrl || 'https://unconfigured.invalid',
  supabaseAnonKey || 'unconfigured'
);
