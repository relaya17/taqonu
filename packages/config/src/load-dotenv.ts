import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenvFile } from "dotenv";

function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Load nearest `.env` walking up from cwd (monorepo root friendly).
 * Does not override variables already set in the process environment.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenvFile({ path: candidate, override: false, quiet: true });
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Server secrets live in `apps/api/.env` (not the web app).
 * Loads root `.env` first (shared/non-secret), then `apps/api/.env` with override
 * so API secrets win and stay out of the web tree.
 */
export function loadServerDotEnv(startDir: string = process.cwd()): string | null {
  const root = findMonorepoRoot(startDir);
  let loaded: string | null = null;

  if (root) {
    const rootEnv = resolve(root, ".env");
    if (existsSync(rootEnv)) {
      loadDotenvFile({ path: rootEnv, override: false, quiet: true });
      loaded = rootEnv;
    }
    const apiEnv = resolve(root, "apps/api/.env");
    if (existsSync(apiEnv)) {
      loadDotenvFile({ path: apiEnv, override: true, quiet: true });
      return apiEnv;
    }
  }

  return loadDotEnv(startDir) ?? loaded;
}
