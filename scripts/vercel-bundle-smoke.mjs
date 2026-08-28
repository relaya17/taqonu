/**
 * Dress rehearsal for the Vercel serverless entries.
 *
 * Loads each app's vercel-bundle.cjs the way api/index.js does, serves it on a
 * throwaway loopback port, and issues a real request. Catches the failures a
 * successful esbuild run hides: empty import.meta.url, top-level listen(),
 * missing createRequestHandler, and boot-time throws.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");

const targets = [
  { name: "api", dir: "apps/api", path: "/health" },
  { name: "admin", dir: "apps/admin", path: "/" },
  { name: "control-plane", dir: "apps/control-plane", path: "/api/v1/status" },
];

let failed = 0;

for (const target of targets) {
  const bundle = join(repoRoot, target.dir, "vercel-bundle.cjs");
  if (!existsSync(bundle)) {
    console.log(`SKIP  ${target.name}: no vercel-bundle.cjs (run bundle:vercel)`);
    continue;
  }

  try {
    const mod = require(bundle);
    if (typeof mod.createRequestHandler !== "function") {
      throw new Error("bundle does not export createRequestHandler");
    }
    const handle = await mod.createRequestHandler();

    const server = createServer(handle);
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}${target.path}`);
    await res.text();
    server.close();

    // Any HTTP status proves the handler booted and answered. 401/503 are
    // correct for a control surface with no token configured.
    console.log(`PASS  ${target.name}: ${target.path} -> ${res.status}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${target.name}: ${err instanceof Error ? err.message : err}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
