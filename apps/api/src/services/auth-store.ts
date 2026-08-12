import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthUser, UserRole } from "@atlas/shared";
import { authUserSchema } from "@atlas/shared";
import { findRepoRoot } from "./repo-root.js";

interface StoredUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  locale: "he" | "en" | "ar";
  provider: "email" | "google" | "github" | "apple" | "local";
  passwordHash: string | null;
  salt: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

interface AuthFile {
  users: StoredUser[];
}

function authPath(): string {
  const fromEnv = process.env.ATLAS_AUTH_PATH;
  if (fromEnv) return fromEnv;
  return resolve(findRepoRoot(), ".atlas", "users.json");
}

function load(): AuthFile {
  const path = authPath();
  if (!existsSync(path)) return { users: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AuthFile;
  } catch {
    return { users: [] };
  }
}

function save(file: AuthFile): void {
  const path = authPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
}

function hashPassword(password: string, salt: Buffer): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function toPublicUser(user: StoredUser): AuthUser {
  return authUserSchema.parse({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    locale: user.locale,
    provider: user.provider,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  });
}

export function findUserByEmail(email: string): StoredUser | undefined {
  const normalized = email.trim().toLowerCase();
  return load().users.find((u) => u.email === normalized);
}

export function findUserById(id: string): StoredUser | undefined {
  return load().users.find((u) => u.id === id);
}

export function listUsers(): AuthUser[] {
  return load().users.map(toPublicUser);
}

export function createLocalUser(input: {
  email: string;
  password: string;
  displayName?: string;
  locale?: "he" | "en" | "ar";
  adminEmail?: string;
}): AuthUser {
  const file = load();
  const email = input.email.trim().toLowerCase();
  if (file.users.some((u) => u.email === email)) {
    throw new Error("EMAIL_TAKEN");
  }
  const salt = randomBytes(16);
  const isAdmin =
    Boolean(input.adminEmail) &&
    input.adminEmail!.trim().toLowerCase() === email;
  const user: StoredUser = {
    id: crypto.randomUUID(),
    email,
    displayName: input.displayName?.trim() || email.split("@")[0] || "user",
    role: isAdmin || file.users.length === 0 ? "admin" : "user",
    locale: input.locale ?? "he",
    provider: "local",
    passwordHash: hashPassword(input.password, salt),
    salt: salt.toString("hex"),
    avatarUrl: null,
    createdAt: new Date().toISOString(),
  };
  // First user always admin for personal instance bootstrap
  if (file.users.length === 0) {
    user.role = "admin";
  }
  file.users.push(user);
  save(file);
  return toPublicUser(user);
}

export function verifyLocalPassword(email: string, password: string): AuthUser | null {
  const user = findUserByEmail(email);
  if (!user?.passwordHash || !user.salt) return null;
  const salt = Buffer.from(user.salt, "hex");
  const hash = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.passwordHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return toPublicUser(user);
}

export interface OAuthUpsertResult {
  readonly user: AuthUser;
  /**
   * When a pre-existing local (email/password) user is linked to OAuth and
   * their local id differed from the Supabase OAuth `sub`, this is the old
   * local id that was rewritten to match. Callers must rekey tenant/cloud
   * owner_id references from this id → `user.id`.
   */
  readonly reconciledFromId: string | null;
}

/**
 * Upsert an OAuth identity. If an existing local user shares the email but
 * has a different id than Supabase's OAuth user, adopt the OAuth id so
 * `auth.uid()` and local `owner_id` stay aligned for RLS.
 */
export function upsertOAuthUser(input: {
  id?: string;
  email: string;
  displayName?: string | null;
  provider: "google" | "github" | "apple";
  avatarUrl?: string | null;
  locale?: "he" | "en" | "ar";
  adminEmail?: string;
}): OAuthUpsertResult {
  const file = load();
  const email = input.email.trim().toLowerCase();
  const existing = file.users.find((u) => u.email === email);
  if (existing) {
    let reconciledFromId: string | null = null;
    if (input.id && input.id !== existing.id) {
      // Guard: do not clobber another account that already owns the OAuth id.
      const collision = file.users.find((u) => u.id === input.id && u.email !== email);
      if (!collision) {
        reconciledFromId = existing.id;
        existing.id = input.id;
      }
    }
    existing.provider = input.provider;
    existing.displayName = input.displayName ?? existing.displayName;
    existing.avatarUrl = input.avatarUrl ?? existing.avatarUrl;
    if (
      input.adminEmail &&
      input.adminEmail.trim().toLowerCase() === email
    ) {
      existing.role = "admin";
    }
    save(file);
    return { user: toPublicUser(existing), reconciledFromId };
  }
  const isAdmin =
    Boolean(input.adminEmail) &&
    input.adminEmail!.trim().toLowerCase() === email;
  const user: StoredUser = {
    id: input.id ?? crypto.randomUUID(),
    email,
    displayName: input.displayName ?? email.split("@")[0] ?? "user",
    role: isAdmin || file.users.length === 0 ? "admin" : "user",
    locale: input.locale ?? "he",
    provider: input.provider,
    passwordHash: null,
    salt: null,
    avatarUrl: input.avatarUrl ?? null,
    createdAt: new Date().toISOString(),
  };
  file.users.push(user);
  save(file);
  return { user: toPublicUser(user), reconciledFromId: null };
}

/**
 * Rewrite a stored user's id (e.g. login-time drift where the Supabase
 * access-token `sub` no longer matches the local record). No-op when ids
 * match or the source user is missing. Returns the updated public user, or
 * null when nothing changed / source missing / target collision.
 */
export function rekeyLocalUserId(fromId: string, toId: string): AuthUser | null {
  if (!fromId || !toId || fromId === toId) return null;
  const file = load();
  const existing = file.users.find((u) => u.id === fromId);
  if (!existing) return null;
  if (file.users.some((u) => u.id === toId)) return null;
  existing.id = toId;
  save(file);
  return toPublicUser(existing);
}

/**
 * Mirror Auth-sourced role onto the local offline/dev store. No-op when the
 * user is missing or the role already matches.
 */
export function setLocalUserRole(userId: string, role: UserRole): AuthUser | null {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing) return null;
  if (existing.role === role) return toPublicUser(existing);
  existing.role = role;
  save(file);
  return toPublicUser(existing);
}

/**
 * Upsert a thin local mirror from Supabase Auth claims (offline fallback).
 * Does not overwrite password hashes. Used when Auth JWT is the live source
 * of truth but local session still needs a row for stub mode continuity.
 */
export function mirrorAuthUserLocally(input: {
  id: string;
  email: string;
  displayName?: string | null;
  role: UserRole;
  locale?: "he" | "en" | "ar";
  provider?: "email" | "google" | "github" | "apple" | "local";
  avatarUrl?: string | null;
}): AuthUser {
  const file = load();
  const email = input.email.trim().toLowerCase();
  const existing = file.users.find((u) => u.id === input.id) ??
    file.users.find((u) => u.email === email);
  if (existing) {
    existing.id = input.id;
    existing.email = email;
    existing.role = input.role;
    if (input.displayName !== undefined && input.displayName !== null) {
      existing.displayName = input.displayName;
    }
    if (input.locale) existing.locale = input.locale;
    if (input.provider) existing.provider = input.provider;
    if (input.avatarUrl !== undefined) existing.avatarUrl = input.avatarUrl;
    save(file);
    return toPublicUser(existing);
  }
  const user: StoredUser = {
    id: input.id,
    email,
    displayName: input.displayName?.trim() || email.split("@")[0] || "user",
    role: input.role,
    locale: input.locale ?? "he",
    provider: input.provider ?? "email",
    passwordHash: null,
    salt: null,
    avatarUrl: input.avatarUrl ?? null,
    createdAt: new Date().toISOString(),
  };
  file.users.push(user);
  save(file);
  return toPublicUser(user);
}

export function signSession(
  userId: string,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 14,
): { token: string; expiresAt: string } {
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: expiresAtMs }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return {
    token: `${payload}.${sig}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function verifySession(
  token: string | undefined,
  secret: string,
): string | null {
  return peekSession(token, secret)?.userId ?? null;
}

/** Validate HMAC + expiry; return subject and real cookie expiry (does not mint a new token). */
export function peekSession(
  token: string | undefined,
  secret: string,
): { userId: string; expiresAt: string } | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub?: string; exp?: number };
    if (!data.sub || !data.exp || Date.now() > data.exp) return null;
    return {
      userId: data.sub,
      expiresAt: new Date(data.exp).toISOString(),
    };
  } catch {
    return null;
  }
}
