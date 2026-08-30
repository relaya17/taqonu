import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createApiRouter } from "./routes/api.js";
import { getDashboardHtml } from "./routes/dashboard.js";
import { html, json, methodNotAllowed, notFound } from "./routes/router.js";
import {
  authorizeControlPlaneRequest,
  isControlPlanePublicPath,
} from "./control-plane-auth.js";
import { refuseAuditMutation } from "./services/governance-state.js";
import {
  applyControlPlaneSecurityHeaders,
  checkRateLimit,
  resolveRequestId,
} from "./services/control-plane-hardening.js";
import {
  authenticateControlBrowser,
  clearControlBrowserSession,
  issueControlBrowserSession,
  readControlBrowserSession,
} from "./browser-session.js";

/**
 * Atlas Control Plane — governance, oversight, and AI agent management.
 *
 * This is the second surface in the Atlas monorepo. While the engineering
 * surface (apps/api, port 3000) runs agents and executes governed actions,
 * the control plane (port 3100) provides the OVERSIGHT view:
 *
 *   - Agent Registry: who are the agents, what can they do, are they active?
 *   - Audit Trail: every governance decision, tamper-evident, searchable.
 *   - Policies: what entity/action pairs exist, what risk tier do they carry?
 *   - Approvals: pending, consumed, expired approval records.
 *   - Health: execution counts, failure rates, risk distribution.
 *
 * ── Separation of concerns ─────────────────────────────────────────────
 *
 * The engineering surface RUNS agents. The control plane INSPECTS and
 * GOVERNS them. An engineer asks "what did the code engineer produce?"
 * A manager asks "is the code engineer allowed to write to production?"
 *
 * Both surfaces live under one monorepo, share the same `@atlas/agent-core`
 * package for type definitions and SDK primitives, and in production
 * connect to the same durable backing stores (database, message queue).
 * But they are independently deployable: upgrading one does not require
 * upgrading the other.
 *
 * ── Port assignment (one product, three origins — never share PORT) ────
 *
 * Atlas product UI:    3000  (apps/web)
 * Tenant API:          4000  (apps/api)
 * Sentinel / CP:       3100  (apps/control-plane)  CONTROL_PLANE_PORT
 * Owner Admin UI:      3200  (apps/admin)          ADMIN_PORT
 *
 * Do not read generic PORT here — Vercel and shells set PORT for the API.
 */

const PORT = parseInt(process.env["CONTROL_PLANE_PORT"] ?? "3100", 10);
const HOST =
  process.env["HOST"] ??
  (process.env["NODE_ENV"] === "production" ? "127.0.0.1" : "127.0.0.1");

const apiRouter = createApiRouter();

function loginHtml(message = ""): string {
  const escaped = message.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Control</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f5f5f5;font:16px sans-serif}main{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #30343b;background:#14171c}h1{font-size:24px;margin:0 0 8px}p{color:#aeb4be}label{display:block;margin-top:16px}input{box-sizing:border-box;width:100%;margin-top:6px;padding:11px;background:#0b0d10;color:#fff;border:1px solid #454b55}button{width:100%;margin-top:20px;padding:12px;border:0;background:#fff;color:#111;font-weight:700;cursor:pointer}.error{color:#ff8c8c}</style></head><body><main><h1>Atlas Control</h1><p>כניסת מפעיל או בעלים</p>${escaped ? `<p class="error">${escaped}</p>` : ""}<form method="post" action="/auth/login"><label>אימייל<input type="email" name="email" autocomplete="username" required></label><label>סיסמה<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">כניסה</button></form></main></body></html>`;
}

async function readLogin(req: IncomingMessage): Promise<{ email: string; password: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error("Login request is too large");
    chunks.push(buffer);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  return { email: form.get("email")?.trim() ?? "", password: form.get("password") ?? "" };
}

async function requestHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // ── CORS headers (allow engineering surface to call control plane) ──
  res.setHeader("Access-Control-Allow-Origin", process.env["WEB_ORIGIN"] ?? "http://localhost:3000");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Atlas-Reason, X-Atlas-Reauth, X-Request-Id, X-Idempotency-Key",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestId = resolveRequestId(req);
  applyControlPlaneSecurityHeaders(res, requestId);

  const pathname = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  ).pathname;
  const method = (req.method ?? "GET").toUpperCase();

  if (pathname === "/favicon.ico" && (method === "GET" || method === "HEAD")) {
    res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
    res.end();
    return;
  }

  if ((pathname === "/" || pathname === "/login") && method === "GET") {
    if (readControlBrowserSession(req)) {
      res.writeHead(303, { Location: "/dashboard" });
      res.end();
      return;
    }
    html(res, loginHtml());
    return;
  }

  if (pathname === "/auth/login" && method === "POST") {
    const credentials = await readLogin(req);
    const session = await authenticateControlBrowser(credentials.email, credentials.password);
    if (!session) {
      html(res, loginHtml("פרטי הכניסה שגויים או שאין הרשאת Control Plane"), 401);
      return;
    }
    res.setHeader("Set-Cookie", issueControlBrowserSession(session.role, session.subject));
    res.writeHead(303, { Location: "/dashboard" });
    res.end();
    return;
  }

  if (pathname === "/auth/logout" && method === "POST") {
    res.setHeader("Set-Cookie", clearControlBrowserSession());
    res.writeHead(303, { Location: "/login" });
    res.end();
    return;
  }

  if (!isControlPlanePublicPath(pathname)) {
    const limited = checkRateLimit(req);
    if (!limited.allowed) {
      res.setHeader("Retry-After", String(limited.retryAfterSec));
      json(res, { error: "Too many requests", requestId }, 429);
      return;
    }
  }

  if (!authorizeControlPlaneRequest(req, res, pathname)) return;

  if (
    pathname.startsWith("/api/v1/audit") &&
    (method === "DELETE" || method === "PUT" || method === "PATCH")
  ) {
    const refused = refuseAuditMutation(method);
    methodNotAllowed(res, refused.error);
    return;
  }

  // ── API routes ─────────────────────────────────────────────────────
  const handled = await apiRouter.handle(req, res);
  if (handled) return;

  if (pathname === "/dashboard") {
    html(res, getDashboardHtml());
    return;
  }

  // ── 404 ────────────────────────────────────────────────────────────
  notFound(res);
}

function handleControlPlaneRequest(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  requestHandler(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[control-plane] unhandled error: ${message}`);
    if (!res.headersSent) {
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
}

/** Entry used by the Vercel serverless function; see api/index.js. */
export function createRequestHandler(): (
  req: IncomingMessage,
  res: ServerResponse,
) => void {
  return handleControlPlaneRequest;
}

const server = createServer(handleControlPlaneRequest);

function shutdown(signal: string): void {
  console.log(`[control-plane] ${signal} — closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

// Vercel invokes the exported handler per request. Binding a port inside a
// serverless function never gets a listener and stalls the invocation.
if (!process.env["VERCEL"]) {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  server.listen(PORT, HOST, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   Atlas Sentinel                                             ║
║   AI Governance · Oversight · Control Plane                  ║
║                                                              ║
║   Dashboard:  http://${HOST}:${PORT}/                             ║
║   API:        http://${HOST}:${PORT}/api/v1/                      ║
║   Status:     http://${HOST}:${PORT}/api/v1/status                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  });
}

export { server };
