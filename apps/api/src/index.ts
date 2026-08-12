/**
 * Vercel Fastify entrypoint.
 *
 * Turbo builds the full API into dist/ first. This shim loads that output so
 * Vercel's post-build TypeScript pass does not re-typecheck the monorepo
 * (including apps/web) under the API tsconfig.
 *
 * Local: `pnpm --filter @atlas/api dev` → src/server.ts
 * Start: `pnpm --filter @atlas/api start` → dist/server.js
 */
import "fastify";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const distServer = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "server.js",
);

if (!existsSync(distServer)) {
  throw new Error(
    `Missing ${distServer}. Run: pnpm exec turbo run build --filter=@atlas/api...`,
  );
}

await import(pathToFileURL(distServer).href);
