import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GOVERNED_COMMANDS } from "./governed-command.js";
import { DEBUG_TARGETS } from "./studio-debug-spawn.js";

const here = dirname(fileURLToPath(import.meta.url));

const IMPORT_FROM = /from\s+["'][^"']*governed-command[^"']*["']/;
const IMPORT_STUDIO_EXECUTION = /from\s+["'][^"']*studio-execution[^"']*["']/;
const CALLS_RUN_GOVERNED_COMMAND = /\brunGovernedCommand\s*\(/;
const USES_GOVERNED_COMMANDS_CATALOG = /\bGOVERNED_COMMANDS\b/;

describe("Debugger isolation from governed-command.ts (Studio Evolution design, locked)", () => {
  it("studio-debug-spawn.ts does not import governed-command.ts or call runGovernedCommand()", () => {
    const code = readFileSync(join(here, "studio-debug-spawn.ts"), "utf8");
    expect(code).not.toMatch(IMPORT_FROM);
    expect(code).not.toMatch(CALLS_RUN_GOVERNED_COMMAND);
    expect(code).not.toMatch(USES_GOVERNED_COMMANDS_CATALOG);
  });

  it("studio-debug-gate.ts does not import governed-command.ts", () => {
    const code = readFileSync(join(here, "studio-debug-gate.ts"), "utf8");
    expect(code).not.toMatch(IMPORT_FROM);
  });

  it("studio-debug-session.ts does not import governed-command.ts or studio-execution.ts", () => {
    const code = readFileSync(join(here, "studio-debug-session.ts"), "utf8");
    expect(code).not.toMatch(IMPORT_FROM);
    expect(code).not.toMatch(IMPORT_STUDIO_EXECUTION);
  });

  it("studio-debug.ts (routes) does not import governed-command.ts or studio-execution.ts", () => {
    const code = readFileSync(join(here, "..", "routes", "studio-debug.ts"), "utf8");
    expect(code).not.toMatch(IMPORT_FROM);
    expect(code).not.toMatch(IMPORT_STUDIO_EXECUTION);
  });

  it("no Debug target id appears in GOVERNED_COMMANDS", () => {
    const governedIds = new Set(GOVERNED_COMMANDS.map((c) => c.id));
    for (const target of DEBUG_TARGETS) {
      expect(governedIds.has(target.id)).toBe(false);
    }
  });

  it("GOVERNED_COMMANDS catalog itself is unchanged (no debug-related entries added)", () => {
    expect(GOVERNED_COMMANDS.some((c) => c.id.includes("debug"))).toBe(false);
  });
});
