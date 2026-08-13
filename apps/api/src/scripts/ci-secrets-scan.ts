/**
 * G5 CI gate — fail the build if allowlisted secret patterns appear in source.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCiSecretScan } from "@atlas/observer";

function findRepoRoot(start: string): string {
  let cur = resolve(start);
  for (;;) {
    if (existsSync(join(cur, "pnpm-workspace.yaml"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return start;
    cur = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);
const result = runCiSecretScan(repoRoot);

if (!result.ok) {
  console.error(
    `CI secret scan failed: ${result.findingCount} finding(s) in apps/packages source.`,
  );
  for (const f of result.findings) {
    console.error(` - ${f.kind} · ${f.path} · ${f.redacted}`);
  }
  process.exit(1);
}

console.log(
  `CI secret scan clean · root=${repoRoot} · packages=${result.scannedRoots.length} · findings=0`,
);
