import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = 'https://kizgeizpsvhdiligebvs.supabase.co';
export const supabaseAnonKey = 'sb_publishable_vreubVAZo01QBlwMCrMDbA_t3EsXKMq'; // publishable (anon) key

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
