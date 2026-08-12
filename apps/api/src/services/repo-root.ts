import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve monorepo root for `.atlas` / fixtures paths.
 *
 * Never walk parent directories on Vercel — @vercel/nft expands those walks
 * into sibling apps (apps/web) and Fastify's TypeScript pass typechecks them.
 */
export function findRepoRoot(from = process.cwd()): string {
  const fromEnv = process.env.ATLAS_REPO_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);

  if (process.env.VERCEL) {
    return from;
  } else {
    // apps/api/{src|dist}/services → monorepo root (four levels up)
    return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  }
}
