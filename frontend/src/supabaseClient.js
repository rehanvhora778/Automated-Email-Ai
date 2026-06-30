import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://kizgeizpsvhdiligebvs.supabase.co'; // Aapka URL
const supabaseAnonKey = 'sb_publishable_vreubVAZo01QBlwMCrMDbA_t3EsXKMq'; // Publishable (anon) key

export const supabase = createClient(supabaseUrl, supabaseAnonKey);