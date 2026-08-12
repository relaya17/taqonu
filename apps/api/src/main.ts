import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { AtlasError } from "@atlas/shared";
import { loadServerEnv } from "@atlas/config";
import { buildApp } from "./create-app.js";

export type NodeHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

function listenPort(fallback: number): number {
  const fromEnv = process.env.PORT?.trim();
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
  return (_req, res) => {
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
    server.listen(port, "0.0.0.0", () => resolve());
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
