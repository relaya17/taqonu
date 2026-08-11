import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthUser, UserRole } from "@atlas/shared";
import { authUserSchema } from "@atlas/shared";

interface StoredUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  locale: "he" | "en" | "ar";
  provider: "email" | "google" | "github" | "local";
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
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return resolve(dir, ".atlas", "users.json");
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(process.cwd(), ".atlas", "users.json");
    dir = parent;
  }
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

export function upsertOAuthUser(input: {
  id?: string;
  email: string;
  displayName?: string | null;
  provider: "google" | "github";
  avatarUrl?: string | null;
  locale?: "he" | "en" | "ar";
  adminEmail?: string;
}): AuthUser {
  const file = load();
  const email = input.email.trim().toLowerCase();
  const existing = file.users.find((u) => u.email === email);
  if (existing) {
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
    return toPublicUser(existing);
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
