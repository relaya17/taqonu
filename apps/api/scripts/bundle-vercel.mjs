import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "server.js");

/**
 * Emit a single Node server entry for Vercel (framework: null / Other).
 * Avoids @vercel/fastify's EXPERIMENTAL_NODE_TYPESCRIPT_ERRORS pass that
 * typechecks NFT-pulled monorepo siblings (apps/web) under the API tsconfig.
 */
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, "dist", "server.js")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: true,
  treeShaking: true,
  legalComments: "none",
  define: {
    "process.env.VERCEL": '"1"',
  },
  external: [
    "fastify",
    "@fastify/*",
    "zod",
    "dotenv",
    "mongodb",
    "sharp",
    "pg",
    "pg-native",
  ],
  logLevel: "info",
});

// Fastify entry names must not remain — otherwise the Fastify preset wins.
for (const stale of ["index.js", "index.mjs", "app.js", "src/app.ts"]) {
  const p = join(root, stale);
  if (existsSync(p)) unlinkSync(p);
}

writeFileSync(
  join(root, ".vercel-bundle-ok"),
  `bundled ${new Date().toISOString()}\n`,
  "utf8",
);

console.log(`Wrote ${outfile} (Node server entry for Vercel Other/null)`);
