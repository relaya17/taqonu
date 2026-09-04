import { createServer } from "node:http";
import { createRequestHandler } from "./http.js";
import { startPeriodicSync, stopPeriodicSync } from "./services/audit-sync.js";

/**
 * Atlas Control Plane — governance, oversight, and AI agent management.
 *
 * Port assignment (never share PORT):
 * Atlas product UI / Studio: 3000  (apps/web)
 * Tenant API:                4000  (apps/api)
 * Atlas Control:             3100  (apps/control-plane)
 * Atlas Admin:               3200  (apps/admin) — supervises Control + Studio
 */

const PORT = parseInt(process.env["CONTROL_PLANE_PORT"] ?? "3100", 10);
const HOST =
  process.env["HOST"] ??
  (process.env["NODE_ENV"] === "production" ? "127.0.0.1" : "127.0.0.1");

const handleControlPlaneRequest = createRequestHandler();
const server = createServer(handleControlPlaneRequest);

function shutdown(signal: string): void {
  console.log(`[control-plane] ${signal} — closing`);
  stopPeriodicSync();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

// Vercel invokes the exported handler per request. Binding a port inside a
// serverless function never gets a listener and stalls the invocation.
if (!process.env["VERCEL"]) {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  startPeriodicSync();
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

export { createRequestHandler } from "./http.js";
export { server };
