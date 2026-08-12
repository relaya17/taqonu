import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, "dist", "server.js")],
  outfile: join(root, "dist", "vercel-server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: true,
  treeShaking: true,
  legalComments: "none",
  // Force-dead-code-eliminate parent-directory FS walks.
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

console.log("Wrote dist/vercel-server.js");
