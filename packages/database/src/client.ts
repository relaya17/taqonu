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

/**
 * Client authenticated as a specific end user (their Supabase access token),
 * not the service role. Postgres RLS policies (`auth.uid() = owner_id`, see
 * `supabase/migrations/20260812003000_rls_projects_evidence_tenant.sql`)
 * apply to every request made through this client — unlike the service-role
 * client, which bypasses RLS entirely. Use this whenever a request is on
 * behalf of one authenticated user (project/evidence writes); fall back to
 * the service-role client only for system-initiated work (webhooks, admin).
 */
export function createUserScopedClient(input: {
  url: string;
  anonKey: string;
  accessToken: string;
}): SupabaseClient {
  return createClient(input.url, input.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  });
}
