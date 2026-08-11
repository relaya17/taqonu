import type { ActionKind, ClassifyActionResult } from "@atlas/shared";

/**
 * Action Engine — classify request into CODE / TEST / INFRA / HUMAN / …
 * Prevents defaulting every problem to "write code".
 */
export function classifyAction(userRequest: string): ClassifyActionResult {
  const t = userRequest.toLowerCase();

  const rules: Array<{
    kind: ActionKind;
    re: RegExp;
    rationale: string;
    requiresHumanApproval: boolean;
    mayProposePatch: boolean;
    confidence: number;
  }> = [
    {
      kind: "HUMAN_ACTION",
      re: /accept|sign|merchant agreement|legal|nda|payplus.*agreement|אשר הסכם|חתימה/,
      rationale: "Requires a human to accept a legal/merchant agreement.",
      requiresHumanApproval: true,
      mayProposePatch: false,
      confidence: 0.92,
    },
    {
      kind: "INFRASTRUCTURE",
      re: /restore|backup|drill|dr\b|supabase db|migration apply|infrastructure|staging restore|שחזור|גיבוי/,
      rationale: "Infrastructure / ops action — not a code patch by default.",
      requiresHumanApproval: true,
      mayProposePatch: false,
      confidence: 0.88,
    },
    {
      kind: "EXTERNAL_INTEGRATION",
      re: /stripe|payplus|yad2|verify.*live|webhook|oauth|production verification|אימות חי/,
      rationale: "Needs external system access / live verification.",
      requiresHumanApproval: true,
      mayProposePatch: false,
      confidence: 0.85,
    },
    {
      kind: "TEST_CHANGE",
      re: /test|regression|coverage|vitest|jest|בדיק|רגרס/,
      rationale: "Primary deliverable is tests.",
      requiresHumanApproval: true,
      mayProposePatch: true,
      confidence: 0.8,
    },
    {
      kind: "DOCUMENTATION",
      re: /document|readme|runbook|changelog|תיעוד|מסמך/,
      rationale: "Documentation update.",
      requiresHumanApproval: true,
      mayProposePatch: true,
      confidence: 0.78,
    },
    {
      kind: "CONFIGURATION",
      re: /config|env\.|feature flag|toggle|הגדרה/,
      rationale: "Configuration change.",
      requiresHumanApproval: true,
      mayProposePatch: true,
      confidence: 0.75,
    },
    {
      kind: "CODE_CHANGE",
      re: /implement|fix|add|refactor|bug|patch|optimistic|algorithm|תיקון|הוסף|שנה/,
      rationale: "Software change — propose Patch under approval gate.",
      requiresHumanApproval: true,
      mayProposePatch: true,
      confidence: 0.82,
    },
  ];

  for (const rule of rules) {
    if (rule.re.test(t)) {
      return {
        kind: rule.kind,
        confidence: rule.confidence,
        rationale: rule.rationale,
        requiresHumanApproval: rule.requiresHumanApproval,
        mayProposePatch: rule.mayProposePatch,
        epistemicState: "INFERRED",
      };
    }
  }

  if (/analy|impact|find all|identify|blocker|חקור|נתח|מצא/.test(t)) {
    return {
      kind: "UNKNOWN",
      confidence: 0.7,
      rationale:
        "Investigative request — collect Evidence / Risk; may not need a Patch.",
      requiresHumanApproval: false,
      mayProposePatch: false,
      epistemicState: "INFERRED",
    };
  }

  return {
    kind: "UNKNOWN",
    confidence: 0.4,
    rationale: "Could not classify confidently — default to investigate + ask.",
    requiresHumanApproval: true,
    mayProposePatch: false,
    epistemicState: "UNKNOWN",
  };
}
