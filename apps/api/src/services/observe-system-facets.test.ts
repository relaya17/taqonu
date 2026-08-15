import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { osStore } from "../store/os-store.js";
import {
  ATLAS_SELF_PROJECT_ID,
  ensureAtlasSelfBound,
} from "./observe-system-facets.js";

describe("ensureAtlasSelfBound", () => {
  const prevSkip = process.env.ATLAS_SKIP_STORE_PERSIST;
  const prevRoot = process.env.ATLAS_REPO_ROOT;
  const root = join(tmpdir(), `atlas-self-${Date.now()}`);

  beforeEach(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"atlas"}');
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    process.env.ATLAS_REPO_ROOT = root;
  });

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.ATLAS_SKIP_STORE_PERSIST;
    else process.env.ATLAS_SKIP_STORE_PERSIST = prevSkip;
    if (prevRoot === undefined) delete process.env.ATLAS_REPO_ROOT;
    else process.env.ATLAS_REPO_ROOT = prevRoot;
  });

  it("registers atlas-core and links the monorepo workspace", () => {
    const bound = ensureAtlasSelfBound();
    expect(bound.projectId).toBeTruthy();
    expect(bound.workspaceRoot).toBe(root);
    const project = osStore.getProject(bound.projectId!);
    expect(project?.slug).toBe("atlas-core");
    expect(osStore.getWorkspaceRoot(bound.projectId!)).toBe(root);
    expect(bound.projectId === ATLAS_SELF_PROJECT_ID || Boolean(project)).toBe(
      true,
    );
  });
});
