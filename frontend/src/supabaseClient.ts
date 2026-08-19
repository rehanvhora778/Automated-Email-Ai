import { createClient } from '@supabase/supabase-js';

/**
 * Supabase browser client.
 *
 * The URL and publishable (anon) key are safe to ship — they are guarded by
 * row-level security, and the service-role key never leaves the backend. They
 * are still read from the environment so a fork can point at its own project
 * without editing source; the defaults keep this repo running as-is.
 */
export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://kizgeizpsvhdiligebvs.supabase.co';

export const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_vreubVAZo01QBlwMCrMDbA_t3EsXKMq';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
