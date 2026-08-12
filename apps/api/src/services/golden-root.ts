import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  inRepoGoldenFixtureRoot,
  resolveGoldenWorkspace,
} from "@atlas/engineering-loop";

function findRepoRoot(from = process.cwd()): string {
  let dir = from;
  for (;;) {
    if (
      existsSync(resolve(dir, "pnpm-workspace.yaml")) ||
      existsSync(resolve(dir, "atlas-evals"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

/**
 * Resolve BrokerOS / golden lab path — names are lab-only, not product locks.
 * Prefer env → brokerOS-main → in-repo `fixtures/golden-brokeros`.
 */
export function defaultGoldenRoot(envRoot?: string | null): string {
  const resolved = resolveGoldenWorkspace({
    envRoot: envRoot ?? process.env.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    cwd: findRepoRoot(),
  });
  return resolved.workspaceRoot;
}

export function resolveWorkspaceRoot(opts: {
  queryRoot?: string | null;
  envRoot?: string | null;
}): string | null {
  const resolved = resolveGoldenWorkspace({
    explicitRoot: opts.queryRoot ?? null,
    envRoot: opts.envRoot ?? null,
    cwd: findRepoRoot(),
  });
  return resolved.exists ? resolved.workspaceRoot : null;
}

/** Expose fixture path for docs/tests. */
export function goldenFixtureRoot(): string {
  return inRepoGoldenFixtureRoot(findRepoRoot());
}
