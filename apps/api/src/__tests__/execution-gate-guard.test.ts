import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P0.7 — proof that the execution gate cannot be bypassed.
 *
 * `executeGovernedAction()` (services/governed-execution.ts) composes every
 * control: identity, tool authorization, approval↔artifact binding, the
 * Policy/Risk gate, the Tool Runtime, and the audit trail. That composition
 * is only worth anything if it is the ONLY way to reach a tool.
 *
 * `executeTool()` is a public export of `@atlas/agent-core`. Nothing in the
 * type system stops a new route, worker or webhook handler from importing it
 * directly and running a tool with no identity, no approval and no audit
 * entry — the exact shape of bypass this project's own audit history keeps
 * rediscovering (see `llm-call-site-guard.test.ts`, which does the same job
 * for outbound LLM calls, and `agent-dispatch-guard.ts`'s doc comment for
 * the "no central dispatcher" version of the story).
 *
 * This is the mechanical backstop: a static scan that FAILS THE BUILD when a
 * second call site appears. It does not prove the gate is correct — the
 * adversarial suite in `governed-execution.test.ts` does that. It proves
 * nothing has quietly grown a way around it.
 */

/**
 * The one file permitted to invoke the Tool Runtime.
 *
 * Adding to this list means adding a path to real tool execution. Before
 * doing so, confirm the new caller performs identity resolution, tool
 * authorization, approval binding and audit — or, far better, route it
 * through `executeGovernedAction()` instead and leave this list alone.
 */
const ALLOWED_TOOL_EXECUTION_SITES: readonly string[] = [
  "apps/api/src/services/governed-execution.ts",
];

/** The Tool Runtime's own module, where the function is defined rather than called. */
const DEFINITION_FILE = "packages/agent-core/src/tools/runtime.ts";

const CALL_PATTERN = "executeTool(";

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".git", ".next", ".turbo"]);

const here = fileURLToPath(new URL(".", import.meta.url));
// here = .../apps/api/src/__tests__ ; repo root is four levels up.
const repoRoot = join(here, "..", "..", "..", "..");

const SCAN_ROOTS = [
  "apps/api/src",
  "apps/worker/src",
  "packages/agent-core/src",
];

function walkTsFiles(absDir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return out; // a scan root that doesn't exist is not a violation
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const abs = join(absDir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...walkTsFiles(abs));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(abs);
    }
  }
  return out;
}

function toRepoRelative(absPath: string): string {
  return relative(repoRoot, absPath).split(sep).join("/");
}

/**
 * Strip line and block comments before scanning.
 *
 * Without this the guard flags its own explanatory prose: this codebase
 * documents heavily, and `executeTool()` is named in half a dozen doc
 * comments. A guard that cannot tell a mention from a call would either be
 * permanently red or be silenced — both useless.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("P0.7 — execution-gate bypass guard (static source scan)", () => {
  it("no file outside the gate calls executeTool(...)", () => {
    const found = new Set<string>();

    for (const root of SCAN_ROOTS) {
      for (const absFile of walkTsFiles(join(repoRoot, root))) {
        const relFile = toRepoRelative(absFile);
        if (relFile === DEFINITION_FILE) continue;

        if (stripComments(readFileSync(absFile, "utf8")).includes(CALL_PATTERN)) {
          found.add(relFile);
        }
      }
    }

    const unexpected = [...found].filter(
      (f) => !ALLOWED_TOOL_EXECUTION_SITES.includes(f),
    );

    expect(
      unexpected,
      unexpected.length === 0
        ? undefined
        : [
            `Found a direct call to executeTool(...) outside the execution gate:`,
            `  ${unexpected.join("\n  ")}`,
            ``,
            `This is a bypass. A tool reached this way runs with no identity`,
            `resolution, no catalog authorization, no approval↔artifact binding`,
            `and no audit entry — every control in P0.2-P0.6 is skipped.`,
            ``,
            `Route the caller through executeGovernedAction()`,
            `(apps/api/src/services/governed-execution.ts) instead. Only add to`,
            `ALLOWED_TOOL_EXECUTION_SITES if that is genuinely impossible, and`,
            `only after confirming the new call site performs identity,`,
            `authorization, approval and audit itself.`,
          ].join("\n"),
    ).toEqual([]);
  });

  it("the allow-list is not stale — the gate still calls executeTool(...)", () => {
    // A dead entry here would silently widen the guard's blind spot.
    const stale = ALLOWED_TOOL_EXECUTION_SITES.filter(
      (relFile) =>
        !stripComments(readFileSync(join(repoRoot, relFile), "utf8")).includes(CALL_PATTERN),
    );
    expect(stale).toEqual([]);
  });
});
