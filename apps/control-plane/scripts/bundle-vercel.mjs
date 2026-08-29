/* eslint-env node */
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "vercel-bundle.cjs");

/**
 * CJS bundle avoids esbuild's ESM "Dynamic require of fs is not supported"
 * failure when transitive deps use require().
 */
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, "dist", "server.js")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  minify: true,
  treeShaking: true,
  legalComments: "none",
  conditions: ["node", "import", "require", "default"],
  mainFields: ["main", "module"],
  define: {
    "process.env.VERCEL": '"1"',
  },
  external: ["sharp", "pg-native", "fsevents"],
  logLevel: "info",
});

console.log(`Wrote ${outfile}`);
