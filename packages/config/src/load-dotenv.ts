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
 * Loads root `.env` first (shared/non-secret), then `apps/api/.env` so API
 * file secrets win over root. Variables already present in the process
 * environment (operator/runtime) always win over both files — otherwise a
 * gitignored `replace-me` placeholder would clobber a live local Supabase
 * session started with temporary env vars.
 */
export function loadServerDotEnv(startDir: string = process.cwd()): string | null {
  const original = { ...process.env };
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
      restoreProcessEnv(original);
      return apiEnv;
    }
  }

  restoreProcessEnv(original);
  return loadDotEnv(startDir) ?? loaded;
}

function restoreProcessEnv(original: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(original)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}
