import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateAgentSuggestion } from "@atlas/shared";
import { getGovernedCommand, listGovernedCommands } from "../services/governed-command.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("User Terminal ≠ Agent execution", () => {
  it("does not expose a PTY commandId on the governed catalog", () => {
    expect(listGovernedCommands().some((row) => row.id.includes("pty"))).toBe(false);
    expect(getGovernedCommand("pty.session")).toBeFalsy();
    expect(getGovernedCommand("unrestricted.shell")).toBeFalsy();
  });

  it("still BLOCKs Agent unrestricted-shell proposals", () => {
    const result = evaluateAgentSuggestion({
      suggestion: {
        projectId: "00000000-0000-4000-8000-000000000001",
        ownerId: "11111111-1111-4111-8111-111111111111",
        text: "Give the agent an unrestricted shell with client argv.",
        source: "llm",
      },
      knowledge: [],
    });
    expect(result.verdict).toBe("CONFLICT");
    expect(result.action).toBe("BLOCK");
    expect(result.modelInvoked).toBe(false);
  });

  it("keeps ask-agent and governed execution free of PTY imports", () => {
    const code = readFileSync(join(here, "code.ts"), "utf8");
    const execution = readFileSync(join(here, "studio-execution.ts"), "utf8");
    const governed = readFileSync(join(here, "..", "services", "governed-command.ts"), "utf8");
    expect(code).not.toMatch(/studio-pty/);
    expect(execution).not.toMatch(/studio-pty/);
    expect(governed).not.toMatch(/node-pty/);
    expect(governed).toMatch(/shell:\s*false/);
  });
});
