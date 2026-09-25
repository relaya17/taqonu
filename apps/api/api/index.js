/**
 * Vercel Serverless Function entry (reliable vs broken server.js capture).
 * All traffic is rewritten here via vercel.json.
 *
 * Bundle is produced by `pnpm run bundle:vercel` during the Vercel build.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {Promise<(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void> | undefined} */
let ready;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const ATLAS_DEV_SURFACE_PORTS = new Set(["3000", "3100", "3200"]);

/**
 * Same contract as `apps/api/src/lib/web-origin.ts`. Kept local so a bundle
 * boot failure can still answer CORS without loading node-pty.
 */
function isAllowedWebOrigin(requestOrigin, webOrigin) {
  if (!requestOrigin) return true;
  if (requestOrigin === webOrigin) return true;
  try {
    const allowed = new URL(webOrigin);
    const incoming = new URL(requestOrigin);
    if (
      LOOPBACK.has(allowed.hostname) &&
      LOOPBACK.has(incoming.hostname) &&
      allowed.protocol === incoming.protocol
    ) {
      if (allowed.port === incoming.port) return true;
      const incomingPort =
        incoming.port || (incoming.protocol === "https:" ? "443" : "80");
      if (ATLAS_DEV_SURFACE_PORTS.has(incomingPort)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function applyConfigCors(req, res) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const webOrigin = process.env.WEB_ORIGIN?.trim() || "http://localhost:3000";
  if (origin && isAllowedWebOrigin(origin, webOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    res.setHeader("Vary", "Origin");
  }
}

function configHandler(message) {
  const body = JSON.stringify({
    error: {
      code: "CONFIG_ERROR",
      message,
      hint: "Set DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY (≥32), COOKIE_SECRET (≥32), and WEB_ORIGIN in the Vercel project env.",
    },
  });
  return (req, res) => {
    applyConfigCors(req, res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(body);
  };
}

async function boot() {
  try {
    const mod = require(join(apiRoot, "vercel-bundle.cjs"));
    if (typeof mod.createRequestHandler !== "function") {
      throw new Error("vercel-bundle.cjs missing createRequestHandler export");
    }
    return await mod.createRequestHandler();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ level: "error", message, service: "atlas-api" }),
    );
    return configHandler(message);
  }
}

export default async function handler(req, res) {
  ready ??= boot();
  const handle = await ready;
  return handle(req, res);
}
