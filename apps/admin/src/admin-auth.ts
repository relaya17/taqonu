import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readAdminBrowserSession } from "./browser-session.js";

export function adminToken(): string | null {
  const raw = process.env["ATLAS_CONTROL_PLANE_TOKEN"]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "localhost" ||
    addr.endsWith("127.0.0.1")
  );
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizeAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const token = adminToken();
  const header = req.headers.authorization;
  const presented =
    typeof header === "string"
      ? /^Bearer\s+(\S+)/i.exec(header.trim())?.[1] ?? null
      : null;

  if (token) {
    if (presented && tokensEqual(presented, token)) return true;
    const browserSession = readAdminBrowserSession(req);
    if (browserSession) {
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (!host || (origin !== `https://${host}` && origin !== `http://${host}`)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Owner Admin origin verification failed" }));
          return false;
        }
      }
      return true;
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Owner Control Plane authentication required" }));
    return false;
  }

  if (process.env["NODE_ENV"] === "production") {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "apps/admin is locked: set ATLAS_CONTROL_PLANE_TOKEN",
      }),
    );
    return false;
  }

  if (isLoopback(req.socket.remoteAddress)) return true;
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Owner UI is loopback-only without a token" }));
  return false;
}
