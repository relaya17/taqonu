import { createDatabaseClients, isLiveSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";
import type { SupabaseSessionEnv } from "./supabase-session.js";

/**
 * Tables that carry a direct `owner_id` column and may have been dual-written
 * under a pre-OAuth local id. Junction tables inherit ownership via FK parents.
 * `account_plans` / `profiles` use owner/user id as PK — handled separately.
 */
const OWNER_ID_TABLES = [
  "projects",
  "memories",
  "decisions",
  "agent_runs",
  "evidence_records",
  "claims",
  "project_state_snapshots",
  "graph_nodes",
  "graph_edges",
  "domain_events",
  "eval_runs",
  "integration_accounts",
  "audit_logs",
  "security_events",
] as const;

export interface IdentityReconcileResult {
  readonly fromId: string;
  readonly toId: string;
  readonly tenantRekeyed: boolean;
  readonly cloudTablesUpdated: readonly string[];
  readonly oldAuthUserRemoved: boolean;
}

/** Claims we care about from a Supabase access token (Auth as SaaS source of truth). */
export interface AccessTokenClaims {
  readonly sub: string;
  readonly email: string | null;
  /** Atlas app role from `app_metadata.atlas_role` (not Supabase's JWT `role` claim). */
  readonly atlasRole: "user" | "admin" | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly provider: "email" | "google" | "github" | "apple" | "local" | null;
  readonly locale: "he" | "en" | "ar" | null;
  /** epoch ms */
  readonly expiresAt: number | null;
}

/**
 * Read identity + Atlas role claims from a Supabase JWT without verifying the
 * signature — only call with tokens that already came from Supabase
 * (sign-in / OAuth / refresh). Prefer `app_metadata.atlas_role` over local
 * session when Supabase is live.
 */
export function readAccessTokenClaims(accessToken: string): AccessTokenClaims | null {
  const parts = accessToken.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as {
      sub?: unknown;
      email?: unknown;
      exp?: unknown;
      app_metadata?: Record<string, unknown> | null;
      user_metadata?: Record<string, unknown> | null;
    };
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    const app = payload.app_metadata ?? {};
    const user = payload.user_metadata ?? {};
    const rawRole = app.atlas_role ?? app.atlasRole;
    const atlasRole =
      rawRole === "admin" || rawRole === "user" ? rawRole : null;
    const providerRaw =
      (typeof app.provider === "string" ? app.provider : null) ??
      (typeof user.provider === "string" ? user.provider : null);
    const provider =
      providerRaw === "google" ||
      providerRaw === "github" ||
      providerRaw === "apple" ||
      providerRaw === "email" ||
      providerRaw === "local"
        ? providerRaw
        : null;
    const localeRaw =
      typeof user.locale === "string" ? user.locale : null;
    const locale =
      localeRaw === "he" || localeRaw === "en" || localeRaw === "ar"
        ? localeRaw
        : null;
    const displayName =
      (typeof user.full_name === "string" && user.full_name) ||
      (typeof user.name === "string" && user.name) ||
      (typeof user.display_name === "string" && user.display_name) ||
      null;
    const avatarUrl =
      (typeof user.avatar_url === "string" && user.avatar_url) ||
      (typeof user.picture === "string" && user.picture) ||
      null;
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      atlasRole,
      displayName,
      avatarUrl,
      provider,
      locale,
      expiresAt:
        typeof payload.exp === "number" && Number.isFinite(payload.exp)
          ? payload.exp * 1000
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Read `sub` from a Supabase JWT without verifying the signature — only call
 * with tokens that already came from Supabase (sign-in / OAuth / refresh).
 */
export function readAccessTokenSubject(accessToken: string): string | null {
  return readAccessTokenClaims(accessToken)?.sub ?? null;
}

/**
 * After a local user id is rewritten to match an OAuth/Supabase id:
 * rekey tenant billing, migrate cloud `owner_id` rows (service role), and
 * best-effort remove the stale mirrored Auth user so password login cannot
 * mint a token under the old id again.
 */
export async function finalizeIdentityReconciliation(input: {
  readonly env: SupabaseSessionEnv;
  readonly fromId: string;
  readonly toId: string;
  /** When set, copy this password onto the OAuth Auth user so email login still works. */
  readonly password?: string;
}): Promise<IdentityReconcileResult> {
  const { fromId, toId, env } = input;
  const tenantRekeyed = osStore.rekeyTenantOwner(fromId, toId);
  let cloudTablesUpdated: string[] = [];
  let oldAuthUserRemoved = false;

  if (!isLiveSupabase(env) || fromId === toId) {
    return { fromId, toId, tenantRekeyed, cloudTablesUpdated, oldAuthUserRemoved };
  }

  try {
    const admin = createDatabaseClients({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    }).service;

    cloudTablesUpdated = await migrateCloudOwnerIds(admin, fromId, toId);

    if (input.password) {
      try {
        await admin.auth.admin.updateUserById(toId, { password: input.password });
      } catch {
        // Non-fatal — OAuth session already works; password login may need reset.
      }
    }

    try {
      const { error } = await admin.auth.admin.deleteUser(fromId);
      if (!error) oldAuthUserRemoved = true;
    } catch {
      // Old mirrored user may never have existed — fine.
    }
  } catch {
    // Cloud migrate is best-effort; local id is already the source of truth.
  }

  return { fromId, toId, tenantRekeyed, cloudTablesUpdated, oldAuthUserRemoved };
}

type ServiceClient = ReturnType<typeof createDatabaseClients>["service"];

async function migrateCloudOwnerIds(
  admin: ServiceClient,
  fromId: string,
  toId: string,
): Promise<string[]> {
  const updated: string[] = [];

  for (const table of OWNER_ID_TABLES) {
    const { error, count } = await admin
      .from(table)
      .update({ owner_id: toId }, { count: "exact" })
      .eq("owner_id", fromId);
    if (!error && (count ?? 0) > 0) updated.push(table);
  }

  // account_plans: owner_id is the primary key
  {
    const { data } = await admin
      .from("account_plans")
      .select("*")
      .eq("owner_id", fromId)
      .maybeSingle();
    if (data) {
      const { error: upsertErr } = await admin
        .from("account_plans")
        .upsert({ ...data, owner_id: toId });
      if (!upsertErr) {
        await admin.from("account_plans").delete().eq("owner_id", fromId);
        updated.push("account_plans");
      }
    }
  }

  // profiles: id mirrors auth.users id
  {
    const { data } = await admin.from("profiles").select("*").eq("id", fromId).maybeSingle();
    if (data) {
      const { error: upsertErr } = await admin
        .from("profiles")
        .upsert({ ...data, id: toId });
      if (!upsertErr) {
        await admin.from("profiles").delete().eq("id", fromId);
        updated.push("profiles");
      }
    }
  }

  return updated;
}
