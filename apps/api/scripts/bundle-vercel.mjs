import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "server.js");

/**
 * Fully self-contained Vercel Node entry (no node_modules externals).
 * Externals + pnpm layout caused FUNCTION_INVOCATION_FAILED at import time.
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
  // Keep runtime env reads intact; only pin VERCEL for DCE of repo walks.
  define: {
    "process.env.VERCEL": '"1"',
  },
  // Native / optional bindings only — everything else must be inlined.
  external: ["sharp", "pg-native", "@biomejs/biome", "fsevents"],
  banner: {
    js: 'import { createRequire as __vercelCreateRequire } from "node:module"; const require = __vercelCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});

for (const stale of ["index.js", "index.mjs", "app.js"]) {
  const p = join(root, stale);
  if (existsSync(p)) unlinkSync(p);
}

writeFileSync(
  join(root, ".vercel-bundle-ok"),
  `bundled ${new Date().toISOString()}\n`,
  "utf8",
);

console.log(`Wrote ${outfile} (fully bundled Node server for Vercel)`);
