import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { AtlasError } from "@atlas/shared";
import { loadServerEnv } from "@atlas/config";
import { isAllowedWebOrigin } from "./lib/web-origin.js";
import { buildApp } from "./create-app.js";

export type NodeHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

function listenPort(fallback: number): number {
  // Prefer API_PORT locally so a generic PORT (Vercel / parent shell) cannot
  // steal 3100/3200 from the Control Plane and Owner Admin surfaces.
  const fromEnv = process.env.API_PORT?.trim() || process.env.PORT?.trim();
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function configErrorMessage(error: unknown): string {
  if (error instanceof AtlasError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "unknown startup error";
}

function configErrorHandler(message: string): NodeHttpHandler {
  const body = JSON.stringify({
    error: {
      code: "CONFIG_ERROR",
      message,
      hint: "Set DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY (≥32), COOKIE_SECRET (≥32), and WEB_ORIGIN in the Vercel project env.",
    },
  });
  return (req, res) => {
    const origin = req.headers.origin;
    const webOrigin = process.env.WEB_ORIGIN?.trim() || "http://localhost:3000";
    if (origin && isAllowedWebOrigin(origin, webOrigin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
    res.end(body);
  };
}

/**
 * Build the Fastify app and return a Node HTTP request handler.
 * Used by the committed Vercel `server.js` entry (sync listen + deferred boot).
 */
export async function createRequestHandler(): Promise<NodeHttpHandler> {
  const env = loadServerEnv();
  const app = await buildApp(env);
  await app.ready();
  return (req, res) => {
    app.server.emit("request", req, res);
  };
}

async function main(): Promise<void> {
  let handle: NodeHttpHandler;
  try {
    handle = await createRequestHandler();
  } catch (error: unknown) {
    const message = configErrorMessage(error);
    console.error(
      JSON.stringify({ level: "error", message, service: "atlas-api" }),
    );
    if (!process.env.VERCEL) {
      process.exit(1);
    }
    handle = configErrorHandler(message);
  }

  const port = listenPort(4000);
  const server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Dual-stack (:: + IPv4) so Windows Chrome `localhost` (::1) works, not only 127.0.0.1.
    server.listen({ port, ipv6Only: false }, () => resolve());
  });
  console.error(
    JSON.stringify({
      level: "info",
      message: "api_started",
      service: "atlas-api",
      port,
    }),
  );
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        message: configErrorMessage(error),
        service: "atlas-api",
      }),
    );
    process.exit(1);
  });
}
