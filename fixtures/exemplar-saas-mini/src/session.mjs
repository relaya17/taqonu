import { verifyToken } from "./auth.mjs";

export function readSessionToken(cookieHeader) {
  const raw = String(cookieHeader || "");
  const match = raw.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function requireSession(secret, cookieHeader) {
  const token = readSessionToken(cookieHeader);
  const userId = token ? verifyToken(secret, token) : null;
  if (!userId) {
    const err = new Error("Not signed in");
    err.statusCode = 401;
    throw err;
  }
  return userId;
}
