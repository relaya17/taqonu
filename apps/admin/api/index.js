/**
 * Vercel Serverless Function entry for Atlas Admin (platform supervisor).
 * All traffic is rewritten here via vercel.json.
 *
 * Bundle is produced by `pnpm run bundle:vercel` during the Vercel build.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {Promise<(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void> | undefined} */
let ready;

function configHandler(message) {
  const body = JSON.stringify({
    error: {
      code: "CONFIG_ERROR",
      message,
      hint: "Set ATLAS_CONTROL_PLANE_URL and ATLAS_CONTROL_PLANE_TOKEN in the Vercel project env.",
    },
  });
  return (_req, res) => {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(body);
  };
}

async function boot() {
  try {
    const mod = require(join(appRoot, "vercel-bundle.cjs"));
    if (typeof mod.createRequestHandler !== "function") {
      throw new Error("vercel-bundle.cjs missing createRequestHandler export");
    }
    return await mod.createRequestHandler();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ level: "error", message, service: "atlas-admin" }),
    );
    return configHandler(message);
  }
}

export default async function handler(req, res) {
  ready ??= boot();
  const handle = await ready;
  return handle(req, res);
}
