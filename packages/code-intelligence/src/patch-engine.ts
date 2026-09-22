import type { EngineeringAgentMode, PatchRisk } from "@atlas/shared";
import {
  ENGINEERING_MODE_META,
} from "@atlas/shared";
import { analyzeImpact } from "./impact.js";
import { analyzeRepository, findFilesByKeyword, readTextFile } from "./analyze.js";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ProposedFileChange {
  path: string;
  action: "add" | "modify" | "delete";
  summary: string;
  afterContent?: string | undefined;
  unifiedDiff?: string | undefined;
  previousContent?: string | null | undefined;
}

export interface PatchProposal {
  title: string;
  reason: string;
  mode: EngineeringAgentMode;
  risk: PatchRisk;
  expectedImpact: string;
  filesChanged: ProposedFileChange[];
  tests: string[];
  evaluationSummary: string;
  analysisGraph: string;
}

function inferRisk(mode: EngineeringAgentMode, fileCount: number): PatchRisk {
  if (mode === "secure" || mode === "implement") return "HIGH";
  if (mode === "fix" || mode === "refactor") return "MEDIUM";
  if (fileCount > 5) return "MEDIUM";
  return "LOW";
}

function safeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function memoryLessonComment(
  items: Array<{ statement: string; type: string; epistemicState: string }> | undefined,
): string {
  if (!items?.length) return "";
  const hit = items.find((item) =>
    /must|idempoten|HMAC|session/i.test(item.statement),
  );
  if (!hit) return "";
  return `// MEMORY: ${hit.statement.slice(0, 160).replace(/\n/g, " ")}\n`;
}

function memorySummaryBlock(
  items: Array<{ statement: string; type: string; epistemicState: string }> | undefined,
): string[] {
  if (!items?.length) return [];
  return [
    "",
    "## Agent memory (do not treat as FACT unless CONFIRMED)",
    ...items.slice(0, 8).map(
      (item) => `- [${item.epistemicState}/${item.type}] ${item.statement.slice(0, 280)}`,
    ),
  ];
}

/** Propose a governed patch from a natural-language engineering request. */
export function proposePatch(input: {
  workspaceRoot: string;
  mode: EngineeringAgentMode;
  userRequest: string;
  title?: string;
  /** Explicit Studio file. Preferred over keyword search (P0-C). */
  focusPath?: string;
  memoryContext?: {
    items: Array<{ statement: string; type: string; epistemicState: string }>;
  };
}): PatchProposal {
  const root = resolve(input.workspaceRoot);
  const analysis = analyzeRepository(root);
  const impact = analyzeImpact(root, input.userRequest.split(/\s+/).slice(0, 3).join(" "));
  const modeMeta = ENGINEERING_MODE_META[input.mode];
  const filesChanged: ProposedFileChange[] = [];

  if (!modeMeta.proposesPatch) {
    return {
      title: input.title ?? `${modeMeta.titleEn}: analysis only`,
      reason: input.userRequest,
      mode: input.mode,
      risk: "LOW",
      expectedImpact: "No files changed (analyze/plan mode)",
      filesChanged: [],
      tests: impact.tests,
      evaluationSummary: [
        "Analyze/plan — no patch files (ADR-015).",
        "",
        "## Repository graph",
        analysis.graphHint,
        "",
        "## Impact heuristic",
        ...impact.riskNotes.map((n) => `- ${n}`),
        ...memorySummaryBlock(input.memoryContext?.items),
        "",
        "Epistemic: INFERRED — use Generate/Fix/… to propose an applyable Patch.",
      ].join("\n"),
      analysisGraph: analysis.graphHint,
    };
  }

  // Explicit delete intent: "delete disposable.ts" / "remove the file notes.md"
  const deleteHint = input.userRequest.match(
    /\b(?:delete|remove)\s+(?:the\s+file\s+)?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/i,
  );
  if (deleteHint?.[1]) {
    const rel = safeRelPath(deleteHint[1]);
    const previous = readTextFile(root, rel);
    if (previous !== null && !rel.includes("..")) {
      filesChanged.push({
        path: rel,
        action: "delete",
        summary: `Delete ${rel}`,
        previousContent: previous,
        unifiedDiff: [
          `--- a/${rel}`,
          "+++ /dev/null",
          ...previous.split("\n").map((line) => `-${line}`),
        ].join("\n"),
      });
    }
  }

  // Prefer an existing matching file to modify; else add a guided stub under docs/atlas/patches
  const focus = input.focusPath ? safeRelPath(input.focusPath) : "";
  const keyword =
    input.userRequest.match(/[A-Za-z][A-Za-z0-9_-]{2,}/)?.[0] ?? "change";
  const matches = findFilesByKeyword(root, keyword, 5);
  const focused =
    focus && !focus.includes("..") && readTextFile(root, focus) !== null
      ? focus
      : null;
  const target =
    focused ??
    matches.find((m) => /\.(ts|tsx)$/.test(m) && !/\.test\./.test(m)) ??
    matches[0];

  // Secure mode must never claim remediation via an ATLAS-PATCH comment.
  // Secret literal removal is applied by the API using the Sentinel detector.
  if (filesChanged.length === 0 && target && input.mode !== "secure") {
    const previous = readTextFile(root, target);
    const banner = [
      "",
      `// ATLAS-PATCH (${input.mode}): ${input.userRequest.slice(0, 120).replace(/\n/g, " ")}`,
      `// Status: PROPOSED — apply only after human APPROVE (ADR-015)`,
      memoryLessonComment(input.memoryContext?.items).trimEnd(),
      "",
    ]
      .filter((line) => line !== "")
      .join("\n") + "\n";
    const after = previous ? `${previous.trimEnd()}\n${banner}` : banner;
    filesChanged.push({
      path: safeRelPath(target),
      action: previous ? "modify" : "add",
      summary: `${modeMeta.titleEn} annotation / hook for: ${keyword}`,
      afterContent: after,
      previousContent: previous,
      unifiedDiff: [
        `--- a/${safeRelPath(target)}`,
        `+++ b/${safeRelPath(target)}`,
        "@@",
        ...banner.split("\n").map((l) => `+${l}`),
      ].join("\n"),
    });
  } else if (filesChanged.length === 0 && input.mode !== "secure") {
    const path = `docs/atlas/patches/${input.mode}-${Date.now()}.md`;
    const body = [
      `# Patch proposal — ${modeMeta.titleEn}`,
      "",
      input.userRequest,
      "",
      "## Graph",
      "```",
      analysis.graphHint,
      "```",
      "",
      "_Generated by Atlas Code Intelligence. Apply is approval-gated._",
    ].join("\n");
    filesChanged.push({
      path,
      action: "add",
      summary: "New patch proposal document",
      afterContent: body,
      previousContent: null,
      unifiedDiff: `--- /dev/null\n+++ b/${path}\n${body
        .split("\n")
        .map((l) => `+${l}`)
        .join("\n")}`,
    });
  }

  // Always propose a companion regression note for fix/test/implement
  if (input.mode === "fix" || input.mode === "test" || input.mode === "implement") {
    const testPath = `docs/atlas/patches/regression-${input.mode}.md`;
    filesChanged.push({
      path: testPath,
      action: "add",
      summary: "Regression checklist for this change",
      afterContent: [
        `# Regression checklist`,
        "",
        `- Request: ${input.userRequest}`,
        `- Mode: ${input.mode}`,
        `- Related tests: ${impact.tests.join(", ") || "none found"}`,
        "",
        "Mark VERIFIED only after tests pass.",
      ].join("\n"),
      previousContent: null,
    });
  }

  const risk = inferRisk(input.mode, filesChanged.length);
  return {
    title: input.title ?? `${modeMeta.titleEn}: ${input.userRequest.slice(0, 80)}`,
    reason: input.userRequest,
    mode: input.mode,
    risk,
    expectedImpact: impact.riskNotes.join("; "),
    filesChanged,
    tests: impact.tests,
    evaluationSummary: [
      `Mode ${input.mode} proposed ${filesChanged.length} file change(s).`,
      `Risk ${risk}.`,
      "WRITE remains approval-gated — Approve & Apply required.",
      ...impact.riskNotes,
      ...memorySummaryBlock(input.memoryContext?.items),
    ].join("\n"),
    analysisGraph: analysis.graphHint,
  };
}

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  rollbackSnapshot: Array<{ path: string; previousContent: string | null }>;
}

/** Apply approved patch files under workspaceRoot (path-traversal safe). */
export function applyPatchFiles(
  workspaceRoot: string,
  files: readonly ProposedFileChange[],
): ApplyResult {
  const root = resolve(workspaceRoot);
  const applied: string[] = [];
  const skipped: string[] = [];
  const rollbackSnapshot: Array<{ path: string; previousContent: string | null }> =
    [];

  for (const file of files) {
    const rel = safeRelPath(file.path);
    if (rel.includes("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
      skipped.push(rel);
      continue;
    }
    const full = join(root, rel);
    if (!full.startsWith(root)) {
      skipped.push(rel);
      continue;
    }

    let previous: string | null = null;
    if (existsSync(full)) {
      try {
        previous = readFileSync(full, "utf8");
      } catch {
        previous = null;
      }
    }
    rollbackSnapshot.push({ path: rel, previousContent: previous });

    if (file.action === "delete") {
      if (existsSync(full)) {
        unlinkSync(full);
        applied.push(rel);
      } else {
        skipped.push(rel);
      }
      continue;
    }
    if (file.afterContent === undefined) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.afterContent, "utf8");
    applied.push(rel);
  }

  return { applied, skipped, rollbackSnapshot };
}

/**
 * Restore only the patched paths in `snapshot` to their pre-apply state.
 *
 * Contract:
 * - `previousContent` string → rewrite that file to the captured content
 *   (modify, or a delete that is being undone).
 * - `previousContent` null → the path did not exist before apply; delete it.
 * - Unrelated files in the workspace are not touched.
 * - This is not a full-tree restore.
 *
 * `ROLLED_BACK` therefore means "patched paths match the pre-apply snapshot",
 * not "the entire filesystem equals some prior tree".
 */
export function rollbackPatchFiles(
  workspaceRoot: string,
  snapshot: readonly { path: string; previousContent: string | null }[],
): string[] {
  const root = resolve(workspaceRoot);
  const restored: string[] = [];
  for (const item of snapshot) {
    const rel = safeRelPath(item.path);
    if (rel.includes("..")) continue;
    const full = join(root, rel);
    if (!full.startsWith(root)) continue;
    if (item.previousContent === null) {
      if (existsSync(full)) {
        unlinkSync(full);
        restored.push(rel);
      }
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, item.previousContent, "utf8");
    restored.push(rel);
  }
  return restored;
}
