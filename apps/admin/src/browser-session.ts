import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const COOKIE_NAME = "atlas_admin_session";
const MAX_AGE_SECONDS = 8 * 60 * 60;

function secret(): string | null {
  return process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim() || null;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueAdminBrowserSession(subject: string): string {
  const key = secret();
  if (!key) throw new Error("ATLAS_CONTROL_PLANE_TOKEN is required");
  const payload = Buffer.from(
    JSON.stringify({ role: "OWNER", subject, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 }),
  ).toString("base64url");
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${payload}.${sign(payload, key)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}${secure}`;
}

export function clearAdminBrowserSession(): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function readAdminBrowserSession(req: IncomingMessage): { readonly subject: string } | null {
  const key = secret();
  const cookie = req.headers.cookie;
  if (!key || typeof cookie !== "string") return null;
  const encoded = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!encoded) return null;
  const separator = encoded.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = encoded.slice(0, separator);
  const presented = Buffer.from(encoded.slice(separator + 1));
  const expected = Buffer.from(sign(payload, key));
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: string;
      subject?: string;
      expiresAt?: number;
    };
    if (parsed.role !== "OWNER" || !parsed.subject || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      return null;
    }
    return { subject: parsed.subject };
  } catch {
    return null;
  }
}

export async function authenticateAdminBrowser(
  email: string,
  password: string,
): Promise<{ readonly subject: string } | null> {
  const apiUrl = (process.env["ATLAS_API_URL"] ?? "http://localhost:4000").replace(/\/$/, "");
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { role?: string; user?: { id?: string } };
  return body.role === "owner" && body.user?.id ? { subject: body.user.id } : null;
}