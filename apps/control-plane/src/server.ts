import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createApiRouter } from "./routes/api.js";
import { getDashboardHtml } from "./routes/dashboard.js";
import { getLandingHtml } from "./routes/landing.js";
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
 * ── Port assignment ────────────────────────────────────────────────────
 *
 * Engineering surface: port 3000 (apps/api)
 * Control plane:       port 3100 (apps/control-plane)
 *
 * Both are started in parallel by `pnpm dev` via turborepo's `--parallel`
 * flag. Each has its own `dev` script in `package.json`.
 */

const PORT = parseInt(process.env["PORT"] ?? "3100", 10);
const HOST =
  process.env["HOST"] ??
  (process.env["NODE_ENV"] === "production" ? "127.0.0.1" : "127.0.0.1");

const apiRouter = createApiRouter();

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

  // ── Dashboard (root) ───────────────────────────────────────────────
  if (pathname === "/" || pathname === "/index.html") {
    html(res, getLandingHtml());
    return;
  }

  if (pathname === "/dashboard") {
    html(res, getDashboardHtml());
    return;
  }

  // ── 404 ────────────────────────────────────────────────────────────
  notFound(res);
}

const server = createServer((req, res) => {
  requestHandler(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[control-plane] unhandled error: ${message}`);
    if (!res.headersSent) {
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });
});

function shutdown(signal: string): void {
  // eslint-disable-next-line no-console
  console.log(`[control-plane] ${signal} — closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
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

export { server };
