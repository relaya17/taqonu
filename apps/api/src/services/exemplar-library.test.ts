import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  buildClonePatch,
  ingestExemplarFromDisk,
} from "./exemplar-library.js";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-exemplar-lib-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { osStore } = await import("../store/os-store.js");

function writeMiniExemplar(root: string) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "atlas-exemplar.json"),
    JSON.stringify({
      slug: "test-ex",
      title: "Test exemplar",
      description: "unit test",
      kind: "mini_app",
      version: "1.0.0",
      completeness: {
        builds: true,
        runsLocally: true,
        hasAuth: true,
        hasConfigAndVersions: true,
        hasTests: true,
        hasDeployPath: true,
        hasEnvExample: true,
        hasCloneMap: true,
      },
      units: [
        {
          id: "whole",
          kind: "WHOLE",
          title: "All",
          description: "all",
          paths: ["src", "README.md"],
          dependsOn: [],
        },
        {
          id: "auth",
          kind: "AUTH",
          title: "Auth",
          description: "auth files",
          paths: ["src/auth.ts"],
          dependsOn: ["config"],
        },
        {
          id: "config",
          kind: "CONFIG",
          title: "Config",
          description: "config",
          paths: ["src/config.ts"],
          dependsOn: [],
        },
      ],
    }),
  );
  writeFileSync(join(root, "README.md"), "# test\n");
  writeFileSync(join(root, "src", "auth.ts"), "export const auth = true;\n");
  writeFileSync(join(root, "src", "config.ts"), "export const v = 1;\n");
}

describe("exemplar-library", () => {
  let src: string;
  let dest: string;

  beforeEach(() => {
    osStore.unloadForTests();
    osStore.ensureLoaded();
    src = mkdtempSync(join(tmpdir(), "ex-src-"));
    dest = mkdtempSync(join(tmpdir(), "ex-dest-"));
    writeMiniExemplar(src);
  });

  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  });

  it("ingests a manifest and clones without writing dest files", () => {
    const record = ingestExemplarFromDisk({
      ownerId: "11111111-1111-4111-8111-111111111111",
      createdBy: "test",
      body: {
        title: "Test exemplar",
        slug: "test-ex",
        kind: "mini_app",
        version: "1.0.0",
        sourceRoot: src,
        visibility: "personal",
      },
    });
    expect(record.slug).toBe("test-ex");
    const projectId = "22222222-2222-4222-8222-222222222222";
    const { patch, cloneReady } = buildClonePatch({
      exemplar: record,
      unitId: "auth",
      workspaceRoot: dest,
      projectId,
      createdBy: "test",
      ownerId: "11111111-1111-4111-8111-111111111111",
    });
    expect(cloneReady).toBe(true);
    expect(patch.status).toBe("AWAITING_APPROVAL");
    const paths = patch.filesChanged.map((f) => f.path);
    expect(paths).toContain("src/auth.ts");
    expect(paths).toContain("src/config.ts");
    expect(existsSync(join(dest, "src", "auth.ts"))).toBe(false);
  });

  it("rejects targetPrefix traversal", () => {
    const record = ingestExemplarFromDisk({
      ownerId: "11111111-1111-4111-8111-111111111111",
      createdBy: "test",
      body: {
        title: "Test exemplar",
        slug: "test-ex",
        kind: "mini_app",
        version: "1.0.0",
        sourceRoot: src,
        visibility: "personal",
      },
    });
    expect(() =>
      buildClonePatch({
        exemplar: record,
        workspaceRoot: dest,
        projectId: "22222222-2222-4222-8222-222222222222",
        targetPrefix: "../outside",
        createdBy: "test",
        ownerId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow(/escapes/);
  });
});
