import { readdir } from "node:fs/promises";
import { registerTool, type ToolImplementation } from "./runtime.js";

const MAX_TOP_LEVEL = 40;

const analyzeRepoTool: ToolImplementation = {
  name: "analyze_repo",
  async run(_args, context) {
    const entries = await readdir(context.projectRoot, {
      withFileTypes: true,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const topLevel = entries.slice(0, MAX_TOP_LEVEL).map((entry) =>
      entry.isDirectory() ? `${entry.name}/` : entry.name,
    );
    return JSON.stringify({
      root: context.projectRoot,
      topLevel,
      truncated: entries.length > MAX_TOP_LEVEL,
    });
  },
};

/** Read-only workspace listing. Idempotent. Execution still goes through executeGovernedAction. */
export function registerAnalyzeRepoTool(): void {
  registerTool(analyzeRepoTool);
}
