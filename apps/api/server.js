/**
 * Vercel Node server entry — must call listen() during module startup.
 * https://vercel.com/docs/functions/runtimes/node-js
 *
 * Heavy Fastify boot lives in ./vercel-bundle.cjs (written by bundle:vercel).
 * Keep this file free of workspace imports so deploy detection stays cheap.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const port = Number(process.env.PORT || 4000);

/** @type {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void} */
let handle = (_req, res) => {
  res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      error: { code: "BOOTING", message: "API cold start in progress" },
    }),
  );
};

const server = createServer((req, res) => {
  handle(req, res);
});

// Synchronous listen — required for Vercel to capture the HTTP server.
server.listen(port);

void Promise.resolve()
  .then(async () => {
    const mod = require("./vercel-bundle.cjs");
    if (typeof mod.createRequestHandler !== "function") {
      throw new Error("vercel-bundle.cjs missing createRequestHandler export");
    }
    handle = await mod.createRequestHandler();
  })
  .catch((err) => {
    const message = err instanceof Error ? err.message : "bundle load failed";
    console.error(
      JSON.stringify({ level: "error", message, service: "atlas-api" }),
    );
    const body = JSON.stringify({
      error: {
        code: "CONFIG_ERROR",
        message,
        hint: "Set DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY (≥32), COOKIE_SECRET (≥32), and WEB_ORIGIN in the Vercel project env.",
      },
    });
    handle = (_req, res) => {
      res.writeHead(503, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(body);
    };
  });
