import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Null until both variables are set, which is the normal state for a local
 * checkout. Everything downstream treats that as "use the bundled catalog"
 * rather than an error, so the app runs with no configuration at all.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
