import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLocalReposRoot } from "./scan.js";

describe("scanLocalReposRoot", () => {
  it("finds nested git repos and parses github remotes", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-local-"));
    const repo = join(root, "demo-app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(
      join(repo, ".git", "config"),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/acme/demo-app.git\n`,
      "utf8",
    );

    const found = scanLocalReposRoot(root, 2);
    expect(found).toHaveLength(1);
    expect(found[0]?.fullName).toBe("acme/demo-app");
    expect(found[0]?.folderName).toBe("demo-app");
  });
});
