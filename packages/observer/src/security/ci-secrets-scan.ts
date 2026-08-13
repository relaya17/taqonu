/**
 * G5 CI — fail if detectSecrets finds live-looking secrets in apps/packages source.
 * Excludes tests, fixtures, lockfiles, and node_modules.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { detectSecrets } from "./secrets.js";

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".atlas",
  "e2e",
]);

function collectRoots(repoRoot: string): string[] {
  const out: string[] = [];
  for (const top of ["apps", "packages"]) {
    const base = join(repoRoot, top);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const full = join(base, name);
      try {
        if (statSync(full).isDirectory() && !SKIP_DIR.has(name)) {
          out.push(full);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

export function runCiSecretScan(repoRoot: string): {
  readonly ok: boolean;
  readonly scannedRoots: readonly string[];
  readonly findingCount: number;
  readonly findings: readonly {
    readonly path: string;
    readonly kind: string;
    readonly redacted: string;
  }[];
} {
  const roots = collectRoots(repoRoot);
  const findings: Array<{ path: string; kind: string; redacted: string }> = [];

  for (const root of roots) {
    const hits = detectSecrets(root, { maxFiles: 80 });
    for (const h of hits) {
      // Ignore unit-test fixtures that intentionally contain fake tokens
      if (/\.(test|spec)\.(ts|tsx|js)$/i.test(h.path)) continue;
      if (/secrets\.test|sentinel\.test|fixture|__fixtures__/i.test(h.path)) {
        continue;
      }
      // Detector source files embed regex samples that look like secrets
      if (
        /(^|\/)secrets\.ts$|(^|\/)detector\.ts$|(^|\/)ci-secrets-scan\.ts$/i.test(
          h.path,
        )
      ) {
        continue;
      }
      findings.push({
        path: relative(repoRoot, join(root, h.path)).split(sep).join("/"),
        kind: h.kind,
        redacted: h.redacted,
      });
    }
  }

  return {
    ok: findings.length === 0,
    scannedRoots: roots.map((r) => relative(repoRoot, r).split(sep).join("/")),
    findingCount: findings.length,
    findings: findings.slice(0, 40),
  };
}
