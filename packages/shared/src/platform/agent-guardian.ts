/**
 * Independent Personal Agent Guardian.
 *
 * MODEL ≠ AGENT. This evaluator never invokes an LLM. It returns
 * CONSISTENT | CONFLICT | UNKNOWN from structured project knowledge
 * and hard policy. UNKNOWN is not converted into CONSISTENT.
 */

import type { AgentKnowledgeFact } from "./agent-project-knowledge.js";
import { factsVisibleTo } from "./agent-project-knowledge.js";

export const GUARDIAN_VERDICTS = ["CONSISTENT", "CONFLICT", "UNKNOWN"] as const;
export type GuardianVerdict = (typeof GUARDIAN_VERDICTS)[number];

export const GUARDIAN_ACTIONS = ["ALLOW", "WARN", "BLOCK"] as const;
export type GuardianAction = (typeof GUARDIAN_ACTIONS)[number];

export interface AgentSuggestionInput {
  readonly projectId: string;
  readonly ownerId: string;
  readonly text: string;
  readonly files?: readonly string[];
  readonly source: "llm" | "heuristic" | "human";
}

export interface GuardianConflict {
  readonly detectorId: string;
  readonly proposedAction: string;
  readonly detectedConflict: string;
  readonly conflictingFact: string;
  readonly source: string;
  readonly path: string | null;
  readonly epistemicState: string;
  readonly affectedScope: string;
  readonly verificationStatus: string;
  readonly nextVerification: string;
}

export interface GuardianEvaluation {
  readonly verdict: GuardianVerdict;
  readonly action: GuardianAction;
  readonly modelInvoked: false;
  readonly knowledgeUsed: number;
  readonly conflicts: readonly GuardianConflict[];
  readonly summary: string;
}

const POLICY_FACTS: readonly AgentKnowledgeFact[] = [
  {
    id: "policy.approval-required",
    projectId: "*",
    ownerId: "*",
    kind: "governance",
    what: "Studio patches require human Approve then Apply. Auto-apply and skip-approval are forbidden.",
    where: null,
    why: "Hard governance policy.",
    source: "guardian-policy",
    epistemicState: "FACT",
    observedAt: "1970-01-01T00:00:00.000Z",
    verifiedAt: "1970-01-01T00:00:00.000Z",
    scope: "policy",
    keywords: ["approval", "apply", "auto-apply"],
    contradicts: [
      "skip approval",
      "without approval",
      "without human approval",
      "auto-apply",
      "auto apply",
    ],
  },
  {
    id: "policy.verify-required",
    projectId: "*",
    ownerId: "*",
    kind: "governance",
    what: "Verify remains required after Apply. Skipping Verify is forbidden.",
    where: null,
    why: "Hard governance policy.",
    source: "guardian-policy",
    epistemicState: "FACT",
    observedAt: "1970-01-01T00:00:00.000Z",
    verifiedAt: "1970-01-01T00:00:00.000Z",
    scope: "policy",
    keywords: ["verify"],
    contradicts: ["skip verify", "without verify", "bypass verify"],
  },
  {
    id: "policy.no-unrestricted-execution",
    projectId: "*",
    ownerId: "*",
    kind: "governance",
    what: "Agent execution is allowlisted commandId only. Unrestricted shell, client argv, and arbitrary commands are forbidden.",
    where: null,
    why: "Hard execution policy.",
    source: "guardian-policy",
    epistemicState: "FACT",
    observedAt: "1970-01-01T00:00:00.000Z",
    verifiedAt: "1970-01-01T00:00:00.000Z",
    scope: "policy",
    keywords: ["shell", "terminal", "command"],
    contradicts: [
      "unrestricted shell",
      "unrestricted terminal",
      "client argv",
      "arbitrary command",
      "rm -rf",
    ],
  },
  {
    id: "policy.no-unrestricted-git",
    projectId: "*",
    ownerId: "*",
    kind: "governance",
    what: "The Agent must not silently commit or push. Git mutation stays human-governed.",
    where: null,
    why: "Hard Git policy.",
    source: "guardian-policy",
    epistemicState: "FACT",
    observedAt: "1970-01-01T00:00:00.000Z",
    verifiedAt: "1970-01-01T00:00:00.000Z",
    scope: "policy",
    keywords: ["commit", "push", "git"],
    contradicts: [
      "unrestricted commit",
      "silently commit",
      "silent commit",
      "silently push",
      "commit and push without",
      "agent push without",
    ],
  },
];

const UNDO_PHRASES = [
  "remove ",
  "delete ",
  "revert ",
  "undo ",
  "drop ",
  "bypass ",
  "skip ",
] as const;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function overlapCount(haystack: string, keywords: readonly string[]): number {
  return keywords.filter((keyword) => {
    const needle = keyword.toLowerCase();
    return needle.length >= 2 && haystack.includes(needle);
  }).length;
}

function phraseHit(haystack: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    if (phrase && haystack.includes(phrase.toLowerCase())) return phrase;
  }
  return null;
}

function conflictFromFact(
  detectorId: string,
  suggestion: string,
  row: AgentKnowledgeFact,
  detectedConflict: string,
  nextVerification: string,
): GuardianConflict {
  return {
    detectorId,
    proposedAction: suggestion.slice(0, 280),
    detectedConflict,
    conflictingFact: row.what,
    source: row.source,
    path: row.where,
    epistemicState: String(row.epistemicState),
    affectedScope: row.scope,
    verificationStatus: row.verifiedAt ? "VERIFIED" : String(row.epistemicState),
    nextVerification,
  };
}

const APP_MENTION = /\bapps\/([a-z0-9._-]+)/gi;
const PKG_MENTION = /\bpackages\/([a-z0-9._-]+)/gi;

export function evaluateAgentSuggestion(input: {
  suggestion: AgentSuggestionInput;
  knowledge: readonly AgentKnowledgeFact[];
}): GuardianEvaluation {
  const suggestionText = normalize(
    [input.suggestion.text, ...(input.suggestion.files ?? [])].join(" "),
  );
  const visible = [
    ...POLICY_FACTS,
    ...factsVisibleTo(
      input.knowledge,
      input.suggestion.projectId,
      input.suggestion.ownerId,
    ),
  ];
  const conflicts: GuardianConflict[] = [];
  let block = false;

  for (const row of visible) {
    const hit = phraseHit(suggestionText, row.contradicts);
    if (!hit) continue;
    const policy = row.scope === "policy";
    conflicts.push(
      conflictFromFact(
        row.id,
        input.suggestion.text,
        row,
        `Proposal matches forbidden phrase "${hit}".`,
        policy
          ? "Keep human Approve → Apply → Verify. Do not weaken governance."
          : "Check the cited file/module and run the affected tests before applying.",
      ),
    );
    if (policy) block = true;
  }

  for (const row of visible) {
    if (row.kind !== "verified-fix") continue;
    const undoing = UNDO_PHRASES.some((phrase) => suggestionText.includes(phrase));
    if (!undoing) continue;
    if (overlapCount(suggestionText, row.keywords) < 2) continue;
    conflicts.push(
      conflictFromFact(
        `verified-fix:${row.id}`,
        input.suggestion.text,
        row,
        "Proposal would undo a verified historical fix.",
        "Re-read the verified-fix memory and run the regression tests that established it.",
      ),
    );
  }

  for (const row of visible) {
    if (row.kind !== "failed-fix") continue;
    if (overlapCount(suggestionText, row.keywords) < 2) continue;
    conflicts.push(
      conflictFromFact(
        `failed-fix:${row.id}`,
        input.suggestion.text,
        row,
        "Proposal restates a previously failed fix. It must not be remembered as a successful solution.",
        "Treat this as a failed historical attempt. Gather new evidence before proposing it again.",
      ),
    );
  }

  const knownApps = new Set(
    visible
      .filter((row) => row.kind === "structure" && row.where?.startsWith("apps/"))
      .map((row) => row.where!.slice("apps/".length).toLowerCase()),
  );
  const knownPackages = new Set(
    visible
      .filter((row) => row.kind === "structure" && row.where?.startsWith("packages/"))
      .map((row) => row.where!.slice("packages/".length).toLowerCase()),
  );

  if (knownApps.size > 0) {
    for (const match of input.suggestion.text.matchAll(APP_MENTION)) {
      const name = match[1]?.toLowerCase();
      if (!name || knownApps.has(name)) continue;
      const structure = visible.find((row) => row.where === `apps/${[...knownApps][0]}`);
      if (!structure) continue;
      conflicts.push(
        conflictFromFact(
          `missing-app:${name}`,
          input.suggestion.text,
          structure,
          `Application apps/${name} is not in the observed workspace structure.`,
          "Confirm the application name against the file tree before proposing the change.",
        ),
      );
    }
  }
  if (knownPackages.size > 0) {
    for (const match of input.suggestion.text.matchAll(PKG_MENTION)) {
      const name = match[1]?.toLowerCase();
      if (!name || knownPackages.has(name)) continue;
      const structure = visible.find(
        (row) => row.where === `packages/${[...knownPackages][0]}`,
      );
      if (!structure) continue;
      conflicts.push(
        conflictFromFact(
          `missing-pkg:${name}`,
          input.suggestion.text,
          structure,
          `Package packages/${name} is not in the observed workspace structure.`,
          "Confirm the package name against the file tree before proposing the change.",
        ),
      );
    }
  }

  if (conflicts.length > 0) {
    const action: GuardianAction = block ? "BLOCK" : "WARN";
    return {
      verdict: "CONFLICT",
      action,
      modelInvoked: false,
      knowledgeUsed: visible.length,
      conflicts,
      summary: block
        ? "CONFLICT — I found a policy conflict. The proposal is blocked until it respects Approve/Apply/Verify."
        : "CONFLICT — I found a conflict with known project facts. The model did not decide this.",
    };
  }

  const supporting = visible.filter((row) => {
    if (row.scope === "policy") return false;
    if (row.kind === "failed-fix") return false;
    return overlapCount(suggestionText, row.keywords) >= 1;
  });

  if (supporting.length === 0) {
    return {
      verdict: "UNKNOWN",
      action: "ALLOW",
      modelInvoked: false,
      knowledgeUsed: visible.length,
      conflicts: [],
      summary:
        "UNKNOWN — I do not have enough evidence to determine whether this proposal is compatible.",
    };
  }

  return {
    verdict: "CONSISTENT",
    action: "ALLOW",
    modelInvoked: false,
    knowledgeUsed: visible.length,
    conflicts: [],
    summary:
      "CONSISTENT — compatible with known verified/observed project facts. This is not a Truth verdict.",
  };
}

export { POLICY_FACTS as GUARDIAN_POLICY_FACTS };
