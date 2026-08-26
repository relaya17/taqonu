import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "./routes/router.js";

/**
 * ADR-021 — Control Plane is not "whoever knows the URL".
 * Liveness (`GET /api/v1/status`) stays public. Everything else needs a token
 * in production. Dev without a token is loopback-only.
 */
export function controlPlaneToken(): string | null {
  const raw = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim();
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

/**
 * @returns true when the request may proceed.
 */
export function authorizeControlPlaneRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): boolean {
  if (isControlPlanePublicPath(pathname)) return true;

  const token = controlPlaneToken();
  const presented = bearerFrom(req);
  if (token) {
    if (presented && tokensEqual(presented, token)) return true;
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

  const remote = req.socket.remoteAddress;
  if (isLoopbackAddress(remote)) return true;
  json(res, { error: "Control Plane is loopback-only without a token" }, 403);
  return false;
}
