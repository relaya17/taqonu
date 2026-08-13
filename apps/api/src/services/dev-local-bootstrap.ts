import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ServerEnv } from "@atlas/config";
import { discoverLocalPortfolio } from "./portfolio-discovery.js";
import { defaultGoldenRoot } from "./golden-root.js";
import { findRepoRoot } from "./repo-root.js";
import { osStore } from "../store/os-store.js";

export interface DevLocalBootstrapResult {
  readonly connected: boolean;
  readonly reposRoot: string | null;
  readonly scanned: number;
  readonly linked: number;
  readonly goldenLinked: boolean;
  readonly note: string;
}

/**
 * Dev convenience: connect sibling `../` (or ATLAS_LOCAL_REPOS_ROOT), scan +
 * auto-link matching local folders, and backfill BrokerOS golden fixture root.
 * No-op in production unless ATLAS_LOCAL_REPOS_ROOT is explicitly set.
 */
export function ensureDevLocalPortfolioLink(
  env: ServerEnv,
): DevLocalBootstrapResult {
  osStore.ensureLoaded();
  const explicit = process.env.ATLAS_LOCAL_REPOS_ROOT?.trim() || null;
  const allowAuto =
    Boolean(explicit) ||
    env.NODE_ENV === "development" ||
    env.NODE_ENV === "test";

  let connected = false;
  let reposRoot: string | null = osStore.getLocalConnection()?.reposRoot ?? null;
  let scanned = 0;
  let linked = 0;
  let note = "skipped";

  if (allowAuto) {
    if (!reposRoot) {
      const candidate = explicit
        ? resolve(explicit)
        : resolve(join(findRepoRoot(), ".."));
      if (existsSync(candidate)) {
        const now = new Date().toISOString();
        osStore.setLocalConnection({
          id: crypto.randomUUID(),
          status: "CONNECTED",
          reposRoot: candidate,
          displayLabel: candidate,
          connectedAt: now,
          updatedAt: now,
          lastError: null,
          lastScanAt: null,
          lastScanRepoCount: null,
        });
        reposRoot = candidate;
        note = explicit
          ? "connected ATLAS_LOCAL_REPOS_ROOT"
          : "connected sibling of repo root";
      } else {
        note = `local root missing: ${candidate}`;
      }
    } else {
      note = "local already connected";
    }

    if (reposRoot) {
      try {
        const discovered = discoverLocalPortfolio({
          reposRoot,
          maxDepth: 2,
          reconcile: false,
          linkLocalRoots: true,
        });
        scanned = discovered.scanned;
        linked = discovered.linked;
        connected = true;
        const connection = osStore.getLocalConnection();
        if (connection) {
          const now = new Date().toISOString();
          osStore.setLocalConnection({
            ...connection,
            status: "CONNECTED",
            updatedAt: now,
            lastError: null,
            lastScanAt: now,
            lastScanRepoCount: discovered.scanned,
          });
        }
        note = `${note}; scanned ${scanned}, linked ${linked}`;
      } catch (error) {
        note = `scan failed: ${error instanceof Error ? error.message : "unknown"}`;
      }
    }
  }

  let goldenLinked = false;
  const goldenSlug =
    process.env.ATLAS_GOLDEN_PROJECT_SLUG?.trim() || "brokeros";
  const broker = osStore.getProjectBySlug(goldenSlug);
  if (broker && !osStore.getWorkspaceRoot(broker.id)) {
    const golden = defaultGoldenRoot(env.ATLAS_GOLDEN_PROJECT_ROOT ?? null);
    if (existsSync(golden)) {
      osStore.setWorkspaceRoot(broker.id, golden);
      goldenLinked = true;
      note = `${note}; golden linked for ${goldenSlug}`;
    }
  }

  return {
    connected,
    reposRoot,
    scanned,
    linked,
    goldenLinked,
    note,
  };
}
