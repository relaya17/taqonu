/**
 * Password reset tokens (local). Production should deliver via email;
 * personal instances may expose the one-time token in non-production responses.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findRepoRoot } from "./repo-root.js";

interface ResetRecord {
  email: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

interface ResetFile {
  tokens: ResetRecord[];
}

function resetPath(): string {
  const fromEnv = process.env.ATLAS_RESET_PATH;
  if (fromEnv) return fromEnv;
  return resolve(findRepoRoot(), ".atlas", "password-resets.json");
}

function load(): ResetFile {
  const path = resetPath();
  if (!existsSync(path)) return { tokens: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ResetFile;
  } catch {
    return { tokens: [] };
  }
}

function save(file: ResetFile): void {
  const path = resetPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPasswordResetToken(email: string): {
  token: string;
  expiresAt: string;
} {
  const normalized = email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 45).toISOString();
  const file = load();
  // Invalidate prior unused tokens for this email
  for (const row of file.tokens) {
    if (row.email === normalized && !row.usedAt) {
      row.usedAt = new Date().toISOString();
    }
  }
  file.tokens.push({
    email: normalized,
    tokenHash: hashToken(token),
    expiresAt,
    usedAt: null,
    createdAt: new Date().toISOString(),
  });
  // Keep file small
  file.tokens = file.tokens.slice(-200);
  save(file);
  return { token, expiresAt };
}

export function consumePasswordResetToken(
  token: string,
): { email: string } | null {
  if (!token || token.length < 20) return null;
  const file = load();
  const hash = hashToken(token);
  const now = Date.now();
  for (const row of file.tokens) {
    if (row.usedAt) continue;
    if (Date.parse(row.expiresAt) < now) continue;
    const a = Buffer.from(row.tokenHash, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) continue;
    row.usedAt = new Date().toISOString();
    save(file);
    return { email: row.email };
  }
  return null;
}
