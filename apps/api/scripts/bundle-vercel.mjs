import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "vercel-bundle.cjs");

/**
 * CJS bundle avoids esbuild's ESM "Dynamic require of fs is not supported"
 * failure when transitive deps use require().
 */
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, "dist", "main.js")],
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
  external: ["sharp", "pg-native", "@biomejs/biome", "fsevents"],
  logLevel: "info",
});

for (const stale of ["vercel-bundle.js", "server.js.bak"]) {
  const p = join(root, stale);
  if (existsSync(p)) unlinkSync(p);
}

const src = readFileSync(outfile, "utf8");
writeFileSync(
  join(root, ".vercel-bundle-ok"),
  `bundled ${new Date().toISOString()} (${(src.length / 1024).toFixed(0)} KB)\n`,
  "utf8",
);

console.log(`Wrote ${outfile} (${(src.length / 1024).toFixed(0)} KB)`);
