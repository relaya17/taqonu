import type { CreateProject, Project } from "@atlas/shared";
import { createDatabaseClients } from "./client.js";
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
): Promise<number | null> {
  if (!isLiveSupabase(env)) {
    return null;
  }
  try {
    const clients = createDatabaseClients({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const repo = new ProjectRepository(clients.service);
    return await repo.countByOwner(ownerId);
  } catch {
    return null;
  }
}

/** Dual-write to Supabase when configured. Throws when `requireSuccess` and cloud is down. */
export async function tryPersistProjectToSupabase(
  env: {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
  },
  input: CreateProject,
  ownerId: string,
  options?: { readonly requireSuccess?: boolean },
): Promise<Project | null> {
  if (!isLiveSupabase(env)) {
    if (options?.requireSuccess) {
      throw new Error("Cloud database is not configured (set live SUPABASE_* keys)");
    }
    return null;
  }
  try {
    const clients = createDatabaseClients({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    const repo = new ProjectRepository(clients.service);
    return await repo.create(input, ownerId);
  } catch (error) {
    if (options?.requireSuccess) {
      throw error;
    }
    return null;
  }
}
