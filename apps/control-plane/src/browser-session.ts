import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type ControlBrowserRole = "OPERATOR" | "OWNER";

const COOKIE_NAME = "atlas_control_session";
const MAX_AGE_SECONDS = 8 * 60 * 60;
const DEVELOPMENT_SECRET = "atlas-local-control-browser-session";

function secret(): string | null {
  return (
    process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim() ||
    (process.env["NODE_ENV"] === "production" ? null : DEVELOPMENT_SECRET)
  );
}

function verificationSecrets(): readonly string[] {
  const current = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim();
  const previous = process.env["ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS"]?.trim();
  const secrets: string[] = [];
  if (current) secrets.push(current);
  if (previous && previous !== current) secrets.push(previous);
  if (secrets.length === 0 && process.env["NODE_ENV"] !== "production") {
    secrets.push(DEVELOPMENT_SECRET);
  }
  return secrets;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueControlBrowserSession(
  role: ControlBrowserRole,
  subject: string,
): string {
  const key = secret();
  if (!key) throw new Error("ATLAS_CONTROL_PLANE_TOKEN is required");
  const payload = Buffer.from(
    JSON.stringify({ role, subject, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 }),
  ).toString("base64url");
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${payload}.${sign(payload, key)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}${secure}`;
}

export function clearControlBrowserSession(): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function readControlBrowserSession(
  req: IncomingMessage,
): { readonly role: ControlBrowserRole; readonly subject: string } | null {
  const keys = verificationSecrets();
  const cookie = req.headers.cookie;
  if (keys.length === 0 || typeof cookie !== "string") return null;
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
  const macOk = keys.some((key) => {
    const expected = Buffer.from(sign(payload, key));
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  });
  if (!macOk) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: string;
      subject?: string;
      expiresAt?: number;
    };
    if (
      (parsed.role !== "OPERATOR" && parsed.role !== "OWNER") ||
      !parsed.subject ||
      !parsed.expiresAt ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return { role: parsed.role, subject: parsed.subject };
  } catch {
    return null;
  }
}

export type ControlBrowserAuthResult =
  | { readonly status: "ok"; readonly role: ControlBrowserRole; readonly subject: string }
  | { readonly status: "mfa_required"; readonly mfaToken: string };

function sessionFromAuthBody(
  body: { role?: string; user?: { id?: string } },
): { readonly role: ControlBrowserRole; readonly subject: string } | null {
  if (body.role !== "operator" && body.role !== "owner") return null;
  const subject = body.user?.id;
  if (!subject) return null;
  return { role: body.role === "owner" ? "OWNER" : "OPERATOR", subject };
}

export async function authenticateControlBrowser(
  email: string,
  password: string,
): Promise<ControlBrowserAuthResult | null> {
  const apiUrl = (process.env["ATLAS_API_URL"] ?? "http://localhost:4000").replace(/\/$/, "");
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    mfaRequired?: boolean;
    mfaToken?: string;
    role?: string;
    user?: { id?: string };
  };
  if (body.mfaRequired === true) {
    if (typeof body.mfaToken !== "string" || body.mfaToken.length < 10) return null;
    return { status: "mfa_required", mfaToken: body.mfaToken };
  }
  const session = sessionFromAuthBody(body);
  return session ? { status: "ok", ...session } : null;
}

export async function completeControlBrowserMfa(
  mfaToken: string,
  code: string,
): Promise<{ readonly role: ControlBrowserRole; readonly subject: string } | null> {
  const apiUrl = (process.env["ATLAS_API_URL"] ?? "http://localhost:4000").replace(/\/$/, "");
  const response = await fetch(`${apiUrl}/api/v1/auth/mfa/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mfaToken, code }),
  });
  if (!response.ok) return null;
  return sessionFromAuthBody((await response.json()) as { role?: string; user?: { id?: string } });
}