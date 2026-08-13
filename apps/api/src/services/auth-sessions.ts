/**
 * Auth session registry — multi-device list + revoke (local high-quality UX).
 * HMAC cookie still carries `sid`; revoked sid fails peek.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findRepoRoot } from "./repo-root.js";

export interface AuthSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  lastSeenAt: string;
  readonly expiresAt: string;
  readonly userAgent: string | null;
  readonly ip: string | null;
  revokedAt: string | null;
}

interface SessionFile {
  sessions: AuthSessionRecord[];
}

function sessionsPath(): string {
  const fromEnv = process.env.ATLAS_SESSIONS_PATH;
  if (fromEnv) return fromEnv;
  return resolve(findRepoRoot(), ".atlas", "sessions.json");
}

function load(): SessionFile {
  const path = sessionsPath();
  if (!existsSync(path)) return { sessions: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionFile;
  } catch {
    return { sessions: [] };
  }
}

function save(file: SessionFile): void {
  const path = sessionsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
}

function prune(file: SessionFile): SessionFile {
  const now = Date.now();
  const cutoff = now - 1000 * 60 * 60 * 24 * 45;
  return {
    sessions: file.sessions.filter((s) => {
      if (Date.parse(s.expiresAt) < now) return false;
      if (s.revokedAt && Date.parse(s.revokedAt) < cutoff) return false;
      return true;
    }),
  };
}

export function recordAuthSession(input: {
  id: string;
  userId: string;
  expiresAt: string;
  userAgent?: string | null;
  ip?: string | null;
}): AuthSessionRecord {
  const file = prune(load());
  const now = new Date().toISOString();
  const row: AuthSessionRecord = {
    id: input.id,
    userId: input.userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: input.expiresAt,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
    revokedAt: null,
  };
  file.sessions.push(row);
  save(file);
  return row;
}

export function touchAuthSession(sessionId: string): void {
  const file = load();
  const row = file.sessions.find((s) => s.id === sessionId && !s.revokedAt);
  if (!row) return;
  row.lastSeenAt = new Date().toISOString();
  save(file);
}

export function isAuthSessionActive(sessionId: string): boolean {
  const row = load().sessions.find((s) => s.id === sessionId);
  if (!row || row.revokedAt) return false;
  return Date.parse(row.expiresAt) > Date.now();
}

export function listAuthSessionsForUser(userId: string): AuthSessionRecord[] {
  return prune(load())
    .sessions.filter((s) => s.userId === userId && !s.revokedAt)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function revokeAuthSession(
  userId: string,
  sessionId: string,
): boolean {
  const file = load();
  const row = file.sessions.find(
    (s) => s.id === sessionId && s.userId === userId && !s.revokedAt,
  );
  if (!row) return false;
  row.revokedAt = new Date().toISOString();
  save(file);
  return true;
}

export function revokeOtherAuthSessions(
  userId: string,
  keepSessionId: string | null,
): number {
  const file = load();
  let n = 0;
  const now = new Date().toISOString();
  for (const row of file.sessions) {
    if (row.userId !== userId || row.revokedAt) continue;
    if (keepSessionId && row.id === keepSessionId) continue;
    row.revokedAt = now;
    n += 1;
  }
  if (n) save(file);
  return n;
}

export function revokeAllAuthSessionsForUser(userId: string): number {
  return revokeOtherAuthSessions(userId, null);
}
