import { describe, expect, it } from "vitest";
import { extractGovernedTarget } from "./governed-target.js";

const ROOT = "/srv/app";

describe("extractGovernedTarget", () => {
  it("maps fs.read_file path to a posix-relative path target", () => {
    const result = extractGovernedTarget("fs.read_file", { path: "src/index.ts" }, ROOT);
    expect(result).toEqual({
      ok: true,
      target: { kind: "path", value: "src/index.ts" },
    });
  });

  it("normalizes src/./index.ts to the same path target as src/index.ts", () => {
    const dotted = extractGovernedTarget("fs.read_file", { path: "src/./index.ts" }, ROOT);
    const plain = extractGovernedTarget("fs.read_file", { path: "src/index.ts" }, ROOT);
    expect(dotted).toEqual(plain);
    expect(dotted).toEqual({
      ok: true,
      target: { kind: "path", value: "src/index.ts" },
    });
  });

  it("maps fs.read_directory '.' to the workspace path token", () => {
    const result = extractGovernedTarget("fs.read_directory", { path: "." }, ROOT);
    expect(result).toEqual({
      ok: true,
      target: { kind: "path", value: "." },
    });
  });

  it("rejects a path that escapes the project root", () => {
    const result = extractGovernedTarget(
      "fs.read_file",
      { path: "../secret" },
      ROOT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toMatch(/escapes the project root|absolute paths are not allowed/);
  });

  it("rejects an absolute path", () => {
    const result = extractGovernedTarget("fs.read_file", { path: "/etc/passwd" }, ROOT);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing or empty path", () => {
    expect(extractGovernedTarget("fs.read_file", {}, ROOT).ok).toBe(false);
    expect(extractGovernedTarget("fs.read_file", { path: "   " }, ROOT).ok).toBe(false);
    expect(extractGovernedTarget("fs.read_file", { path: 1 }, ROOT).ok).toBe(false);
  });

  it("trims fs.search_repo query and does not treat it as a path", () => {
    const result = extractGovernedTarget(
      "fs.search_repo",
      { query: "  Foo  ", path: "src/index.ts" },
      ROOT,
    );
    expect(result).toEqual({
      ok: true,
      target: { kind: "query", value: "Foo" },
    });
  });

  it("rejects knowledge_search without a query", () => {
    const result = extractGovernedTarget("knowledge_search", { path: "src/index.ts" }, ROOT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toMatch(/"query" is required/);
  });

  it("maps analyze_repo to workspace '.' even with empty args", () => {
    const result = extractGovernedTarget("analyze_repo", {}, ROOT);
    expect(result).toEqual({
      ok: true,
      target: { kind: "workspace", value: "." },
    });
  });

  it("ignores extra toolArgs keys for path tools", () => {
    const result = extractGovernedTarget(
      "fs.read_file",
      { path: "src/index.ts", flag: true },
      ROOT,
    );
    expect(result).toEqual({
      ok: true,
      target: { kind: "path", value: "src/index.ts" },
    });
  });

  it("fails closed for tools without an approved extractor", () => {
    for (const toolName of ["fs.write_patch", "propose_patch", "github.create_pr", "unknown"]) {
      const result = extractGovernedTarget(toolName, { path: "src/a.ts" }, ROOT);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.reason).toBe(`No governed target extractor for "${toolName}"`);
    }
  });
});
