import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyStudioLanguageEdits,
  studioLanguageDefinition,
  studioLanguageDiagnostics,
  studioLanguageHover,
  studioLanguageReferences,
  studioLanguageRename,
  studioLanguageSymbols,
} from "./typescript-service.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "atlas-ls-"));
  dirs.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "src", "math.ts"),
    [
      "export function add(left: number, right: number): number {",
      "  return left + right;",
      "}",
      "export const total = add(1, 2);",
      "export const broken: number = 'nope';",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(root, "src", "app.ts"),
    ['import { add } from "./math.ts";', "export const used = add(3, 4);", ""].join("\n"),
    "utf8",
  );
  writeFileSync(join(root, ".env"), "SECRET=1\n", "utf8");
  mkdirSync(join(root, "node_modules", "hidden"), { recursive: true });
  writeFileSync(join(root, "node_modules", "hidden", "x.ts"), "export const leak = 1;\n");
  return root;
}

describe("Studio TypeScript language service", () => {
  it("reports compiler diagnostics for a type error", () => {
    const root = fixture();
    const diags = studioLanguageDiagnostics(root, "src/math.ts");
    expect(diags.some((row) => row.message.toLowerCase().includes("number"))).toBe(true);
    expect(diags.every((row) => row.path === "src/math.ts")).toBe(true);
    expect(diags.some((row) => row.line >= 5)).toBe(true);
  });

  it("returns type-aware hover and go-to-definition", () => {
    const root = fixture();
    const hover = studioLanguageHover(root, "src/app.ts", 2, 22);
    expect(hover?.display ?? "").toMatch(/add/i);
    const def = studioLanguageDefinition(root, "src/app.ts", 2, 22);
    expect(def?.path).toBe("src/math.ts");
    expect(def?.line).toBe(1);
  });

  it("finds references and rename locations without touching node_modules", () => {
    const root = fixture();
    const refs = studioLanguageReferences(root, "src/math.ts", 1, 17);
    expect(refs.some((row) => row.path === "src/app.ts")).toBe(true);
    expect(refs.every((row) => !row.path.includes("node_modules"))).toBe(true);
    const edits = studioLanguageRename(root, "src/math.ts", 1, 17, "sum");
    expect(edits.some((row) => row.path === "src/math.ts" && row.newText === "sum")).toBe(true);
    expect(edits.some((row) => row.path === "src/app.ts")).toBe(true);
    const math = [
      "export function add(left: number, right: number): number {",
      "  return left + right;",
      "}",
      "export const total = add(1, 2);",
      "export const broken: number = 'nope';",
      "",
    ].join("\n");
    const renamed = applyStudioLanguageEdits(math, edits, "src/math.ts");
    expect(renamed).toContain("function sum(");
    expect(renamed).toContain("sum(1, 2)");
  });

  it("returns document symbols and ignores secret files", () => {
    const root = fixture();
    const symbols = studioLanguageSymbols(root, "src/math.ts");
    expect(symbols.some((row) => row.name === "add")).toBe(true);
    expect(studioLanguageDiagnostics(root, ".env")).toEqual([]);
  });
});
