import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { osStore } from "../store/os-store.js";
import {
  buildPortfolioDiscoveryStatus,
  discoverLocalPortfolio,
  isPathInsideConfiguredRoot,
  linkDiscoveredWorkspaceRoot,
} from "./portfolio-discovery.js";

describe("portfolio-discovery", () => {
  const dirs: string[] = [];

  beforeAll(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  });

  afterAll(() => {
    delete process.env.ATLAS_SKIP_STORE_PERSIST;
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  it("isPathInsideConfiguredRoot rejects escape paths", () => {
    const root = tempDir("atlas-path-");
    expect(isPathInsideConfiguredRoot(join(root, "a"), root)).toBe(true);
    expect(isPathInsideConfiguredRoot(root, root)).toBe(true);
    expect(isPathInsideConfiguredRoot(join(root, "..", "escape"), root)).toBe(
      false,
    );
  });

  it("discoverLocalPortfolio registers and links workspaceRoot", () => {
    const root = tempDir("atlas-local-disc-");
    const unique = `demo-${Date.now().toString(36)}`;
    const repo = join(root, unique);
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(
      join(repo, ".git", "config"),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/acme/${unique}.git\n`,
      "utf8",
    );

    const result = discoverLocalPortfolio({
      reposRoot: root,
      maxDepth: 2,
      reconcile: false,
      linkLocalRoots: true,
    });

    expect(result.scanned).toBe(1);
    expect(result.created + result.updated).toBeGreaterThanOrEqual(1);
    expect(result.linked).toBe(1);
    const project = result.projects[0];
    expect(project?.slug).toBe(unique);
    expect(osStore.getWorkspaceRoot(project!.id)).toBe(repo);

    const status = buildPortfolioDiscoveryStatus();
    const item = status.projects.find((p) => p.slug === unique);
    expect(item?.linkStatus).toBe("LINKED");
    expect(status.unlinkedProjects.every((p) => p.slug !== unique)).toBe(true);
  });

  it("linkDiscoveredWorkspaceRoot enforces configured local root", () => {
    const base = tempDir("atlas-link-");
    const reposRoot = join(base, "allowed");
    mkdirSync(reposRoot, { recursive: true });
    const inside = join(reposRoot, "app");
    mkdirSync(inside, { recursive: true });
    const outside = join(base, "outside");
    mkdirSync(outside, { recursive: true });

    osStore.setLocalConnection({
      id: crypto.randomUUID(),
      status: "CONNECTED",
      reposRoot,
      displayLabel: reposRoot,
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: null,
      lastScanAt: null,
      lastScanRepoCount: null,
    });

    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    osStore.upsertProject({
      id: projectId,
      slug: `link-me-${Date.now().toString(36)}`,
      name: "Link Me",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });

    const linked = linkDiscoveredWorkspaceRoot({
      projectId,
      workspaceRoot: inside,
    });
    expect(linked.workspaceRoot).toBe(inside);

    expect(() =>
      linkDiscoveredWorkspaceRoot({
        projectId,
        workspaceRoot: outside,
      }),
    ).toThrow(/inside the configured local reposRoot/);
  });
});
