import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthUser, UserRole } from "@atlas/shared";
import { authUserSchema } from "@atlas/shared";
import {
  generateSecret as generateTotpSecret,
  generateURI as generateTotpUri,
  verify as verifyTotpToken,
} from "otplib";
import { findRepoRoot } from "./repo-root.js";
import {
  isAuthSessionActive,
  recordAuthSession,
  touchAuthSession,
} from "./auth-sessions.js";

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
  updatedAt: string;
  emailVerifiedAt: string | null;
  disabledAt: string | null;
  passwordChangedAt: string | null;
  /**
   * Base32 TOTP secret. Unlike passwords this cannot be one-way hashed — the
   * server must recompute HMAC codes from it on every verification — so it
   * is stored as plaintext in the same file-backed store as the rest of the
   * user record. Set as soon as `/auth/mfa/setup` runs (before the user has
   * proven they can generate a valid code), but `mfaEnabled` stays false
   * until `/auth/mfa/confirm` succeeds, so a secret nobody has confirmed can
   * never gate a login. Cleared on disable.
   */
  mfaSecret: string | null;
  /** Only true once `/auth/mfa/confirm` has verified a code against `mfaSecret`. */
  mfaEnabled: boolean;
  /**
   * One-time recovery codes, each stored as `${saltHex}:${scryptHashHex}`
   * (same scrypt scheme as `passwordHash`/`salt` above) — never plaintext at
   * rest. Consumed (removed) on first successful use.
   */
  mfaBackupCodes: string[] | null;
}

interface AuthFile {
  users: StoredUser[];
}

function authPath(): string {
  const fromEnv = process.env.ATLAS_AUTH_PATH;
  if (fromEnv) return fromEnv;
  return resolve(findRepoRoot(), ".atlas", "users.json");
}

function normalizeUser(raw: Partial<StoredUser> & Pick<StoredUser, "id" | "email">): StoredUser {
  const createdAt = raw.createdAt ?? new Date().toISOString();
  return {
    id: raw.id,
    email: raw.email,
    displayName: raw.displayName ?? null,
    role: raw.role === "admin" ? "admin" : "user",
    locale: raw.locale === "en" || raw.locale === "ar" ? raw.locale : "he",
    provider:
      raw.provider === "google" ||
      raw.provider === "github" ||
      raw.provider === "apple" ||
      raw.provider === "email" ||
      raw.provider === "local"
        ? raw.provider
        : "local",
    passwordHash: raw.passwordHash ?? null,
    salt: raw.salt ?? null,
    avatarUrl: raw.avatarUrl ?? null,
    createdAt,
    updatedAt: raw.updatedAt ?? createdAt,
    emailVerifiedAt: raw.emailVerifiedAt ?? null,
    disabledAt: raw.disabledAt ?? null,
    passwordChangedAt: raw.passwordChangedAt ?? null,
    mfaSecret: raw.mfaSecret ?? null,
    mfaEnabled: Boolean(raw.mfaEnabled),
    mfaBackupCodes: Array.isArray(raw.mfaBackupCodes) ? raw.mfaBackupCodes : null,
  };
}

function load(): AuthFile {
  const path = authPath();
  if (!existsSync(path)) return { users: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as AuthFile;
    return { users: (parsed.users ?? []).map((u) => normalizeUser(u)) };
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

// ---------------------------------------------------------------------------
// MFA (TOTP) — secret generation, code verification, backup-code hashing.
// ---------------------------------------------------------------------------

const MFA_ISSUER = "Atlas";
/** ±1 time-step (30s) clock-drift tolerance, matching common authenticator apps. */
const MFA_EPOCH_TOLERANCE_SEC = 30;
const MFA_BACKUP_CODE_COUNT = 8;

function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
}

/** scrypt-hash a backup code the same way passwords are hashed — one-way, salted. */
function hashBackupCode(code: string, salt: Buffer = randomBytes(16)): string {
  const hash = scryptSync(normalizeBackupCode(code), salt, 32).toString("hex");
  return `${salt.toString("hex")}:${hash}`;
}

function matchesBackupCode(entry: string, candidate: string): boolean {
  const [saltHex, hashHex] = entry.split(":");
  if (!saltHex || !hashHex) return false;
  let salt: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
  } catch {
    return false;
  }
  const candidateHash = Buffer.from(
    scryptSync(normalizeBackupCode(candidate), salt, 32).toString("hex"),
    "hex",
  );
  const stored = Buffer.from(hashHex, "hex");
  return (
    candidateHash.length > 0 &&
    candidateHash.length === stored.length &&
    timingSafeEqual(candidateHash, stored)
  );
}

function generateBackupCode(): string {
  const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Plaintext backup codes — only ever returned once, at `/auth/mfa/setup` time. */
function generateBackupCodes(count = MFA_BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => generateBackupCode());
}

async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const token = code.trim();
  if (!/^\d{6,8}$/.test(token)) return false;
  try {
    const result = await verifyTotpToken({
      secret,
      token,
      strategy: "totp",
      epochTolerance: MFA_EPOCH_TOLERANCE_SEC,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Verify a code against a user's TOTP secret, falling back to backup codes.
 * Mutates `existing.mfaBackupCodes` (removing the matched entry) when a
 * backup code was used — caller is responsible for persisting via `save()`.
 * Returns false without mutation when nothing matches.
 */
async function verifyMfaCodeForUser(existing: StoredUser, code: string): Promise<boolean> {
  if (!existing.mfaEnabled || !existing.mfaSecret) return false;
  if (await verifyTotp(existing.mfaSecret, code)) return true;
  if (!existing.mfaBackupCodes?.length) return false;
  const idx = existing.mfaBackupCodes.findIndex((entry) => matchesBackupCode(entry, code));
  if (idx === -1) return false;
  existing.mfaBackupCodes.splice(idx, 1);
  return true;
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
    updatedAt: user.updatedAt,
    emailVerified: Boolean(user.emailVerifiedAt) || user.provider !== "local",
    disabled: Boolean(user.disabledAt),
    hasPassword: Boolean(user.passwordHash && user.salt),
    mfaEnabled: user.mfaEnabled,
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
  const now = new Date().toISOString();
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
    createdAt: now,
    updatedAt: now,
    emailVerifiedAt: null,
    disabledAt: null,
    passwordChangedAt: now,
    mfaSecret: null,
    mfaEnabled: false,
    mfaBackupCodes: null,
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
  if (user.disabledAt) return null;
  const salt = Buffer.from(user.salt, "hex");
  const hash = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.passwordHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return toPublicUser(user);
}

// ---------------------------------------------------------------------------
// MFA (TOTP) enrollment lifecycle: setup (pending) -> confirm (enabled) ->
// disable. Two-step setup/confirm so a user can never get locked out by a
// secret they never proved they could generate a code from.
// ---------------------------------------------------------------------------

export interface MfaSetupResult {
  readonly secret: string;
  readonly otpauthUrl: string;
  readonly backupCodes: string[];
}

/**
 * Begin (or restart) MFA enrollment: generates a fresh TOTP secret + backup
 * codes and stores them, but leaves `mfaEnabled` false. Throws
 * `MFA_ALREADY_ENABLED` when the account already has MFA on — callers must
 * disable (with a valid code) before re-enrolling, otherwise a stolen
 * session cookie alone would let an attacker silently swap in a secret they
 * control, which `/auth/mfa/verify` would then accept.
 */
export function beginMfaSetup(userId: string): MfaSetupResult | null {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing) return null;
  if (existing.mfaEnabled) {
    throw new Error("MFA_ALREADY_ENABLED");
  }
  const secret = generateTotpSecret();
  const backupCodes = generateBackupCodes();
  existing.mfaSecret = secret;
  existing.mfaBackupCodes = backupCodes.map((code) => hashBackupCode(code));
  existing.updatedAt = new Date().toISOString();
  save(file);
  const otpauthUrl = generateTotpUri({
    strategy: "totp",
    issuer: MFA_ISSUER,
    label: existing.email,
    secret,
  });
  return { secret, otpauthUrl, backupCodes };
}

/**
 * Confirm a pending MFA setup: only flips `mfaEnabled` to true once the
 * caller has demonstrated a valid TOTP code from the pending secret (backup
 * codes are not accepted here — they only make sense once MFA is live).
 */
export async function confirmMfaSetup(userId: string, code: string): Promise<AuthUser | null> {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing || !existing.mfaSecret || existing.mfaEnabled) return null;
  if (!(await verifyTotp(existing.mfaSecret, code))) return null;
  existing.mfaEnabled = true;
  existing.updatedAt = new Date().toISOString();
  save(file);
  return toPublicUser(existing);
}

/**
 * Disable MFA. Requires a currently-valid TOTP or backup code — a signed-in
 * session alone is not sufficient, so a stolen session cookie can't be used
 * to turn off the second factor.
 */
export async function disableMfa(userId: string, code: string): Promise<AuthUser | null> {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing) return null;
  if (!(await verifyMfaCodeForUser(existing, code))) return null;
  existing.mfaEnabled = false;
  existing.mfaSecret = null;
  existing.mfaBackupCodes = null;
  existing.updatedAt = new Date().toISOString();
  save(file);
  return toPublicUser(existing);
}

/**
 * Verify a code (TOTP or backup) for an already-`mfaEnabled` account without
 * disabling MFA — used by `/auth/mfa/verify` to complete a login that was
 * held pending. Persists backup-code consumption on success.
 */
export async function verifyMfaLoginCode(userId: string, code: string): Promise<AuthUser | null> {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing) return null;
  if (!(await verifyMfaCodeForUser(existing, code))) return null;
  save(file);
  return toPublicUser(existing);
}

// ---------------------------------------------------------------------------
// Pending MFA login challenges: issued by `/auth/login` when the password was
// correct but a second factor is still required. In-memory only (never
// written to the users.json file, never logged) and single-use.
//
// Deliberate tradeoff: the challenge holds the already-verified plaintext
// password for its short TTL. This lets `/auth/mfa/verify` drive the exact
// same session-issuing path as a normal login (including the Supabase
// password-grant sign-in in `routes/auth.ts`'s `completeLoginSession`)
// instead of duplicating/forking that logic for the MFA branch. The password
// already sits in process memory for the duration of a normal login request
// anyway; this only extends that to a few minutes, scoped to one random
// unguessable token, and it is deleted on first use or expiry.
// ---------------------------------------------------------------------------

interface PendingMfaLogin {
  readonly userId: string;
  readonly password: string;
  readonly expiresAt: number;
}

const MFA_LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const pendingMfaLogins = new Map<string, PendingMfaLogin>();

function pruneExpiredMfaLoginChallenges(): void {
  const now = Date.now();
  for (const [token, entry] of pendingMfaLogins) {
    if (now > entry.expiresAt) pendingMfaLogins.delete(token);
  }
}

/** Issue a short-lived opaque token identifying a password-verified, MFA-pending login. */
export function createMfaLoginChallenge(
  userId: string,
  password: string,
): { mfaToken: string; expiresAt: string } {
  pruneExpiredMfaLoginChallenges();
  const mfaToken = randomBytes(32).toString("base64url");
  const expiresAtMs = Date.now() + MFA_LOGIN_CHALLENGE_TTL_MS;
  pendingMfaLogins.set(mfaToken, { userId, password, expiresAt: expiresAtMs });
  return { mfaToken, expiresAt: new Date(expiresAtMs).toISOString() };
}

/** Non-destructive read — used to resolve which user a code should be checked against. */
export function peekMfaLoginChallenge(mfaToken: string): { userId: string } | null {
  const entry = pendingMfaLogins.get(mfaToken);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingMfaLogins.delete(mfaToken);
    return null;
  }
  return { userId: entry.userId };
}

/** Single-use: deletes the challenge and returns its password for session issuance. */
export function consumeMfaLoginChallenge(
  mfaToken: string,
): { userId: string; password: string } | null {
  const entry = pendingMfaLogins.get(mfaToken);
  pendingMfaLogins.delete(mfaToken);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return { userId: entry.userId, password: entry.password };
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
    existing.updatedAt = new Date().toISOString();
    if (!existing.emailVerifiedAt) {
      existing.emailVerifiedAt = existing.updatedAt;
    }
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
  const now = new Date().toISOString();
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
    createdAt: now,
    updatedAt: now,
    emailVerifiedAt: now,
    disabledAt: null,
    passwordChangedAt: null,
    mfaSecret: null,
    mfaEnabled: false,
    mfaBackupCodes: null,
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
  existing.updatedAt = new Date().toISOString();
  save(file);
  return toPublicUser(existing);
}

export function updateLocalUserProfile(
  userId: string,
  patch: {
    displayName?: string | null;
    locale?: "he" | "en" | "ar";
    avatarUrl?: string | null;
  },
): AuthUser | null {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing || existing.disabledAt) return null;
  if (patch.displayName !== undefined) {
    const name = patch.displayName?.trim() || null;
    existing.displayName = name;
  }
  if (patch.locale) existing.locale = patch.locale;
  if (patch.avatarUrl !== undefined) {
    existing.avatarUrl = patch.avatarUrl?.trim() || null;
  }
  existing.updatedAt = new Date().toISOString();
  save(file);
  return toPublicUser(existing);
}

export function changeLocalPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): AuthUser | null {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing?.passwordHash || !existing.salt || existing.disabledAt) return null;
  const salt = Buffer.from(existing.salt, "hex");
  const currentHash = hashPassword(currentPassword, salt);
  const a = Buffer.from(currentHash, "hex");
  const b = Buffer.from(existing.passwordHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const nextSalt = randomBytes(16);
  existing.salt = nextSalt.toString("hex");
  existing.passwordHash = hashPassword(newPassword, nextSalt);
  existing.passwordChangedAt = new Date().toISOString();
  existing.updatedAt = existing.passwordChangedAt;
  save(file);
  return toPublicUser(existing);
}

export function setLocalPasswordByEmail(
  email: string,
  newPassword: string,
): AuthUser | null {
  const file = load();
  const normalized = email.trim().toLowerCase();
  const existing = file.users.find((u) => u.email === normalized);
  if (!existing || existing.disabledAt) return null;
  const nextSalt = randomBytes(16);
  existing.salt = nextSalt.toString("hex");
  existing.passwordHash = hashPassword(newPassword, nextSalt);
  existing.passwordChangedAt = new Date().toISOString();
  existing.updatedAt = existing.passwordChangedAt;
  if (existing.provider === "google" || existing.provider === "github" || existing.provider === "apple") {
    // Keep OAuth provider; password becomes an additional local factor.
  } else {
    existing.provider = "local";
  }
  if (!existing.emailVerifiedAt) {
    existing.emailVerifiedAt = existing.updatedAt;
  }
  save(file);
  return toPublicUser(existing);
}

export function setUserDisabled(
  userId: string,
  disabled: boolean,
): AuthUser | null {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing) return null;
  existing.disabledAt = disabled ? new Date().toISOString() : null;
  existing.updatedAt = new Date().toISOString();
  save(file);
  return toPublicUser(existing);
}

export function deleteLocalUser(userId: string): boolean {
  const file = load();
  const before = file.users.length;
  file.users = file.users.filter((u) => u.id !== userId);
  if (file.users.length === before) return false;
  save(file);
  return true;
}

export function markEmailVerified(userId: string): AuthUser | null {
  const file = load();
  const existing = file.users.find((u) => u.id === userId);
  if (!existing) return null;
  existing.emailVerifiedAt = new Date().toISOString();
  existing.updatedAt = existing.emailVerifiedAt;
  save(file);
  return toPublicUser(existing);
}

export function signSession(
  userId: string,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 14,
  meta?: { userAgent?: string | null; ip?: string | null },
): { token: string; expiresAt: string; sessionId: string } {
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  const sessionId = crypto.randomUUID();
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: expiresAtMs, sid: sessionId }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  const expiresAt = new Date(expiresAtMs).toISOString();
  recordAuthSession({
    id: sessionId,
    userId,
    expiresAt,
    userAgent: meta?.userAgent ?? null,
    ip: meta?.ip ?? null,
  });
  return {
    token: `${payload}.${sig}`,
    expiresAt,
    sessionId,
  };
}

export function verifySession(
  token: string | undefined,
  secret: string,
): string | null {
  return peekSession(token, secret)?.userId ?? null;
}

/** Validate HMAC + expiry + session registry; return subject and real cookie expiry. */
export function peekSession(
  token: string | undefined,
  secret: string,
): { userId: string; expiresAt: string; sessionId: string | null } | null {
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
    ) as { sub?: string; exp?: number; sid?: string };
    if (!data.sub || !data.exp || Date.now() > data.exp) return null;
    if (data.sid) {
      if (!isAuthSessionActive(data.sid)) return null;
      touchAuthSession(data.sid);
    }
    const stored = findUserById(data.sub);
    if (stored?.disabledAt) return null;
    return {
      userId: data.sub,
      expiresAt: new Date(data.exp).toISOString(),
      sessionId: data.sid ?? null,
    };
  } catch {
    return null;
  }
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
    existing.updatedAt = new Date().toISOString();
    save(file);
    return toPublicUser(existing);
  }
  const now = new Date().toISOString();
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
    createdAt: now,
    updatedAt: now,
    emailVerifiedAt: now,
    disabledAt: null,
    passwordChangedAt: null,
    mfaSecret: null,
    mfaEnabled: false,
    mfaBackupCodes: null,
  };
  file.users.push(user);
  save(file);
  return toPublicUser(user);
}
