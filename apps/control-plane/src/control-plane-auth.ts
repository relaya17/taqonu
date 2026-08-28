import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "./routes/router.js";

/** Authenticated Control Plane caller — a SERVICE, never a default owner. */
export const CONTROL_PLANE_SERVICE_ID = "cp:service";

export type ControlPlanePrincipalRole = "OWNER" | "OPERATOR";

export interface ControlPlanePrincipal {
  readonly kind: "SERVICE";
  readonly id: typeof CONTROL_PLANE_SERVICE_ID;
  readonly actorKind: "SYSTEM";
  /** Distinct role so owner-only ops can be guarded separately. */
  readonly role: ControlPlanePrincipalRole;
}

let resolvedPrincipalRole: ControlPlanePrincipalRole | null = null;

export function resolveControlPlanePrincipal(): ControlPlanePrincipal {
  const role = resolvedPrincipalRole ?? "OPERATOR";
  return { kind: "SERVICE", id: CONTROL_PLANE_SERVICE_ID, actorKind: "SYSTEM", role };
}

/** Returns true if the current request was authenticated with the owner token. */
export function isOwnerPrincipal(): boolean {
  return resolvedPrincipalRole === "OWNER";
}

/**
 * ADR-021 — Control Plane is not "whoever knows the URL".
 * Liveness (`GET /api/v1/status`) stays public. Everything else needs a token
 * in production. Dev without a token is loopback-only.
 */
export function controlPlaneToken(): string | null {
  const raw = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/**
 * Separate owner token grants elevated privileges over the operator token.
 * This is not MFA — it's a distinct credential for owner-only operations.
 */
export function controlPlaneOwnerToken(): string | null {
  const raw = process.env["ATLAS_CONTROL_PLANE_OWNER_TOKEN"]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === ":1" ||
    addr === "localhost" ||
    addr.endsWith("127.0.0.1")
  );
}

function bearerFrom(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? null;
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isControlPlanePublicPath(pathname: string): boolean {
  return pathname === "/api/v1/status";
}

const REAUTH_TTL_MS = 5 * 60 * 1000;
const consumedReauthTickets = new Set<string>();

function reauthSecret(): string {
  return controlPlaneToken() ?? "atlas-dev-loopback-reauth";
}

export function issueReauthTicket(now = Date.now()): {
  readonly ticket: string;
  readonly expiresAt: string;
} {
  const expires = now + REAUTH_TTL_MS;
  const nonce = randomBytes(16).toString("hex");
  const body = `${expires}.${nonce}`;
  const mac = createHmac("sha256", reauthSecret()).update(body).digest("hex");
  return { ticket: `${body}.${mac}`, expiresAt: new Date(expires).toISOString() };
}

/**
 * HMAC reauth is not MFA. Tickets are one-shot until TTL so a captured
 * header cannot be replayed for a second privileged mutation.
 */
export function verifyReauthTicket(
  ticket: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!ticket) return false;
  const lastDot = ticket.lastIndexOf(".");
  if (lastDot <= 0) return false;
  const body = ticket.slice(0, lastDot);
  const mac = ticket.slice(lastDot + 1);
  const expires = Number(body.split(".")[0]);
  if (!Number.isFinite(expires) || expires < now) return false;
  const expected = createHmac("sha256", reauthSecret()).update(body).digest("hex");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  if (!timingSafeEqual(left, right)) return false;
  if (consumedReauthTickets.has(ticket)) return false;
  consumedReauthTickets.add(ticket);
  return true;
}

export function resetConsumedReauthTicketsForTests(): void {
  consumedReauthTickets.clear();
}

export function isSensitiveControlMutation(pathname: string, method: string): boolean {
  if (method !== "POST") return false;
  return (
    pathname === "/api/v1/gateway/ops" ||
    (pathname.startsWith("/api/v1/agents/") && pathname.endsWith("/control"))
  );
}

/**
 * Reset the resolved principal role (for testing).
 */
export function resetPrincipalRoleForTests(): void {
  resolvedPrincipalRole = null;
}

/**
 * @returns true when the request may proceed.
 */
export function authorizeControlPlaneRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): boolean {
  resolvedPrincipalRole = null;

  if (isControlPlanePublicPath(pathname)) return true;

  const ownerToken = controlPlaneOwnerToken();
  const operatorToken = controlPlaneToken();
  const presented = bearerFrom(req);

  // Check owner token first (higher privilege)
  if (ownerToken && presented && tokensEqual(presented, ownerToken)) {
    resolvedPrincipalRole = "OWNER";
    return true;
  }

  // Check operator token
  if (operatorToken && presented && tokensEqual(presented, operatorToken)) {
    resolvedPrincipalRole = "OPERATOR";
    return true;
  }

  // If any token is configured but none matched, deny
  if (ownerToken || operatorToken) {
    json(res, { error: "Control Plane authentication required" }, 401);
    return false;
  }

  const production = process.env["NODE_ENV"] === "production";
  if (production) {
    json(
      res,
      {
        error:
          "Control Plane is locked: set ATLAS_CONTROL_PLANE_TOKEN (ADR-021)",
      },
      503,
    );
    return false;
  }

  // Loopback dev defaults to OPERATOR
  const remote = req.socket.remoteAddress;
  if (isLoopbackAddress(remote)) {
    resolvedPrincipalRole = "OPERATOR";
    return true;
  }
  json(res, { error: "Control Plane is loopback-only without a token" }, 403);
  return false;
}

/**
 * Guard for owner-only Control Plane operations.
 * Call after authorizeControlPlaneRequest returns true.
 */
export function requireOwnerRole(
  res: ServerResponse,
): boolean {
  if (resolvedPrincipalRole === "OWNER") return true;
  json(res, { error: "Control Plane owner role required" }, 403);
  return false;
}
