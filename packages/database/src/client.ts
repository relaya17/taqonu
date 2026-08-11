import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface DatabaseClients {
  readonly anon: SupabaseClient;
  readonly service: SupabaseClient;
}

export function createDatabaseClients(input: {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}): DatabaseClients {
  return {
    anon: createClient(input.url, input.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    service: createClient(input.url, input.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}
