import { createClient, SupabaseClient } from '@supabase/supabase-js';

let clientInstance: SupabaseClient | null = null;
let configuredUrl = '';

export function getSupabaseClient(supabaseUrl?: string, supabaseAnonKey?: string): SupabaseClient | null {
  if (clientInstance && (!supabaseUrl || supabaseUrl === configuredUrl)) {
    return clientInstance;
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }
  configuredUrl = supabaseUrl;
  clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return clientInstance;
}
