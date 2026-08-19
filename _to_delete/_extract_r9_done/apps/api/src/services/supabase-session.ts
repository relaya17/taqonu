import type { UserRole } from "@atlas/shared";
import { createDatabaseClients, isLiveSupabase } from "@atlas/database";

/**
 * Per-user Supabase Auth session, threaded server-side so cloud writes can
 * run through a user-scoped client (RLS-enforced) instead of the
 * service-role client (bypasses RLS). See `packages/database/AUTH_RLS.md`.
 *
 * When Supabase is live, the access token in `atlas_sb_session` is the
 * identity + roles source of truth (`app_metadata.atlas_role` + mirrored
 * `profiles.role`). Local `atlas_session` is the offline/dev fallback only.
 * Never sent to the client as part of `/auth/session` — it stays in an
 * HttpOnly cookie the browser can't read, and this module never returns it
 * in any API response body.
 */

const COOKIE = "atlas_sb_session";
const REFRESH_BUFFER_MS = 60_000;

export interface SupabaseSessionEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
}

export interface SupabaseUserSession {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** epoch ms */
  readonly expiresAt: number;
}

/**
 * Identity Supabase Auth itself vouches for — the only fields safe to base
 * an authorization decision on for a token that arrived from outside this
 * process (e.g. a client-supplied cookie).
 */
export interface VerifiedSupabaseUser {
  readonly id: string;
  readonly email: string | null;
  readonly appMetadata: Record<string, unknown>;
  readonly userMetadata: Record<string, unknown>;
}

/**
 * THE trust boundary for any client-supplied Supabase access token (e.g. the
 * `accessToken` embedded in the `atlas_sb_session` cookie, which arrives on
 * the raw `Cookie` request header and can therefore be set to any value by a
 * non-browser HTTP client — `HttpOnly` only stops browser JS from reading
 * it, it does nothing to stop a client from sending an arbitrary `Cookie`
 * header in the first place).
 *
 * Round-trips to Supabase Auth via `auth.getUser(accessToken)`, which
 * validates the JWT signature, expiry, and revocation state server-side and
 * returns the real, current user record if and only if the token is a
 * genuine, still-valid, Supabase-issued access token. Never decodes the
 * token locally to determine identity/roles — see `readAccessTokenClaims`
 * in `identity-reconcile.ts` for why that alone is not safe to trust.
 */
export async function verifySupabaseAccessToken(
  env: SupabaseSessionEnv,
  accessToken: string,
): Promise<VerifiedSupabaseUser | null> {
  if (!isLiveSupabase(env) || !accessToken) return null;
  try {
    const client = anonClient(env);
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data?.user?.id) return null;
    return {
      id: data.user.id,
      email: typeof data.user.email === "string" ? data.user.email : null,
      appMetadata: (data.user.app_metadata ?? {}) as Record<string, unknown>,
      userMetadata: (data.user.user_metadata ?? {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function anonClient(env: SupabaseSessionEnv) {
  return createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).anon;
}

function adminClient(env: SupabaseSessionEnv) {
  return createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).service;
}

/**
 * Mirror a local (email/password) user into Supabase Auth with the SAME id,
 * so `auth.uid()` on the Supabase side lines up with the local user id
 * already used as `owner_id` on cloud rows. Writes `app_metadata.atlas_role`
 * and upserts `profiles.role` so Auth is the SaaS source of truth for roles.
 * Idempotent — treats "already registered" as success then syncs role.
 * Non-fatal by design: local auth keeps working even if the mirror write
 * fails (e.g. Supabase briefly down).
 */
export async function ensureSupabaseAuthUser(
  env: SupabaseSessionEnv,
  input: {
    readonly id: string;
    readonly email: string;
    readonly password: string;
    readonly role?: UserRole;
    readonly displayName?: string | null;
    readonly locale?: "he" | "en" | "ar";
    readonly provider?: string;
  },
): Promise<void> {
  if (!isLiveSupabase(env)) return;
  const role: UserRole = input.role ?? "user";
  try {
    const admin = adminClient(env);
    const { error } = await admin.auth.admin.createUser({
      id: input.id,
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { atlas_role: role, provider: input.provider ?? "email" },
      user_metadata: {
        ...(input.displayName ? { full_name: input.displayName } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
      },
    });
    if (error && !/already registered|already exists|duplicate/i.test(error.message)) {
      throw error;
    }
    // Existing users: push role/metadata so Auth stays authoritative.
    await syncSupabaseAuthRole(env, {
      id: input.id,
      role,
      email: input.email,
      displayName: input.displayName ?? null,
      ...(input.locale ? { locale: input.locale } : {}),
      provider: input.provider ?? "email",
    });
  } catch {
    // Mirror is best-effort — local session remains the offline fallback.
  }
}

/**
 * Push Atlas role (+ profile mirror) into live Supabase Auth.
 * Prefer this after register/login/OAuth so JWT claims carry `atlas_role`.
 */
export async function syncSupabaseAuthRole(
  env: SupabaseSessionEnv,
  input: {
    readonly id: string;
    readonly role: UserRole;
    readonly email?: string | null;
    readonly displayName?: string | null;
    readonly locale?: "he" | "en" | "ar";
    readonly provider?: string | null;
    readonly avatarUrl?: string | null;
  },
): Promise<void> {
  if (!isLiveSupabase(env)) return;
  try {
    const admin = adminClient(env);
    await admin.auth.admin.updateUserById(input.id, {
      app_metadata: {
        atlas_role: input.role,
        ...(input.provider ? { provider: input.provider } : {}),
      },
      user_metadata: {
        ...(input.displayName ? { full_name: input.displayName } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
      },
    });
    await admin.from("profiles").upsert({
      id: input.id,
      role: input.role,
      ...(input.email ? { email: input.email } : {}),
      ...(input.displayName !== undefined
        ? { display_name: input.displayName }
        : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      ...(input.provider ? { auth_provider: input.provider } : {}),
      ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort — JWT may still lack atlas_role until next successful sync.
  }
}

/** Sign in to Supabase Auth as the user, returning a real access token usable for RLS-scoped writes. */
export async function signInSupabaseUser(
  env: SupabaseSessionEnv,
  input: { readonly email: string; readonly password: string },
): Promise<SupabaseUserSession | null> {
  if (!isLiveSupabase(env)) return null;
  try {
    const client = anonClient(env);
    const { data, error } = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error || !data.session) return null;
    return toSession(data.session);
  } catch {
    return null;
  }
}

export async function refreshSupabaseSession(
  env: SupabaseSessionEnv,
  refreshToken: string,
): Promise<SupabaseUserSession | null> {
  if (!isLiveSupabase(env)) return null;
  try {
    const client = anonClient(env);
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) return null;
    return toSession(data.session);
  } catch {
    return null;
  }
}

function toSession(session: {
  access_token: string;
  refresh_token: string | null;
  expires_at?: number;
}): SupabaseUserSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ? session.expires_at * 1000 : Date.now() + 3600_000,
  };
}

export function serializeSupabaseSessionCookie(session: SupabaseUserSession): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const payload = encodeURIComponent(JSON.stringify(session));
  return `${COOKIE}=${payload}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}${secure}`;
}

export function clearSupabaseSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readSupabaseSessionCookie(
  cookieHeader: string | undefined,
): SupabaseUserSession | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) === COOKIE) {
      try {
        const parsed = JSON.parse(decodeURIComponent(part.slice(idx + 1))) as Partial<SupabaseUserSession>;
        if (typeof parsed.accessToken !== "string" || typeof parsed.expiresAt !== "number") {
          return null;
        }
        return {
          accessToken: parsed.accessToken,
          refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
          expiresAt: parsed.expiresAt,
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Resolve a usable (non-expired) Supabase access token for the current
 * request, transparently refreshing via the stored refresh token when the
 * cached one is stale. `setCookie` is non-null only when a refresh
 * happened — callers should attach it to their reply.
 */
export async function resolveRequestSupabaseAccessToken(
  env: SupabaseSessionEnv,
  cookieHeader: string | undefined,
): Promise<{ readonly accessToken: string | null; readonly setCookie: string | null }> {
  if (!isLiveSupabase(env)) return { accessToken: null, setCookie: null };
  const session = readSupabaseSessionCookie(cookieHeader);
  if (!session) return { accessToken: null, setCookie: null };
  if (session.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return { accessToken: session.accessToken, setCookie: null };
  }
  if (!session.refreshToken) return { accessToken: null, setCookie: null };
  const refreshed = await refreshSupabaseSession(env, session.refreshToken);
  if (!refreshed) return { accessToken: null, setCookie: null };
  return { accessToken: refreshed.accessToken, setCookie: serializeSupabaseSessionCookie(refreshed) };
}
