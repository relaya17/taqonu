import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenvFile } from "dotenv";

/**
 * Load nearest `.env` walking up from cwd (monorepo root friendly).
 * Does not override variables already set in the process environment.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenvFile({ path: candidate, override: false });
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
