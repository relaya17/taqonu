import type { CreateProject, Project } from "@atlas/shared";
import { createDatabaseClients, createUserScopedClient } from "./client.js";
import { ProjectRepository } from "./repositories/projects.js";

export function isLiveSupabase(env: {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}): boolean {
  if (env.SUPABASE_SERVICE_ROLE_KEY === "replace-me") {
    return false;
  }
  if (env.SUPABASE_URL.includes("127.0.0.1") || env.SUPABASE_URL.includes("localhost")) {
    // Local supabase is live if not placeholder key
    return env.SUPABASE_SERVICE_ROLE_KEY.length > 20;
  }
  return true;
}

export async function countCloudProjects(
  env: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
  },
  ownerId: string,
  userAccessToken?: string | null,
): Promise<number | null> {
  if (!isLiveSupabase(env)) {
    return null;
  }
  try {
    const client = resolveClient(env, userAccessToken);
    const repo = new ProjectRepository(client);
    return await repo.countByOwner(ownerId);
  } catch {
    return null;
  }
}

/**
 * Dual-write to Supabase when configured. Throws when `requireSuccess` and cloud is down.
 *
 * When `userAccessToken` is supplied (the caller's own Supabase access token —
 * see `apps/api/src/services/supabase-session.ts`), the write goes through a
 * user-scoped client and is constrained by RLS (`auth.uid() = owner_id`).
 * Without it, this falls back to the service-role client, which bypasses RLS —
 * only appropriate for system-initiated writes (webhooks, admin backfills).
 */
export async function tryPersistProjectToSupabase(
  env: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
  },
  input: CreateProject,
  ownerId: string,
  options?: { readonly requireSuccess?: boolean; readonly userAccessToken?: string | null },
): Promise<Project | null> {
  if (!isLiveSupabase(env)) {
    if (options?.requireSuccess) {
      throw new Error("Cloud database is not configured (set live SUPABASE_* keys)");
    }
    return null;
  }
  try {
    const client = resolveClient(env, options?.userAccessToken);
    const repo = new ProjectRepository(client);
    return await repo.create(input, ownerId);
  } catch (error) {
    if (options?.requireSuccess) {
      throw error;
    }
    return null;
  }
}

function resolveClient(
  env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string },
  userAccessToken?: string | null,
) {
  if (userAccessToken) {
    return createUserScopedClient({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      accessToken: userAccessToken,
    });
  }
  return createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).service;
}
