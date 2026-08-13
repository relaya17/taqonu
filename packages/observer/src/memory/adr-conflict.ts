import { analyzeRepository, readTextFile } from "@atlas/code-intelligence";
import type { BehaviorDifference } from "@atlas/shared";

export interface AdrConflict {
  adrPath: string;
  flowId: string;
  title: string;
  detail: string;
  matchedTerms: string[];
}

const RULES: { terms: RegExp; topic: string }[] = [
  { terms: /idempotent|exactly.?once|retry|webhook/i, topic: "idempotency/webhooks" },
  { terms: /payment|charge|billing|stripe/i, topic: "payment ordering" },
  { terms: /confirm|confirmation|receipt/i, topic: "confirmation sequencing" },
  { terms: /tenant|isolation|multi.?tenant/i, topic: "tenant isolation" },
  { terms: /auth|permission|rbac|authorization/i, topic: "authorization" },
];

/** Flag behavior drifts that conflict with ADR/decision text. */
export function detectAdrConflicts(
  workspaceRoot: string,
  diffs: readonly BehaviorDifference[],
): AdrConflict[] {
  if (!diffs.length) return [];
  const analysis = analyzeRepository(workspaceRoot);
  const paths = analysis.sampleFiles.filter(
    (p) =>
      /(^|\/)ADR[-_].+\.md$/i.test(p) ||
      /\/decisions\//i.test(p) ||
      /docs\/adr\//i.test(p),
  );
  const conflicts: AdrConflict[] = [];

  for (const adrPath of paths) {
    const text = readTextFile(workspaceRoot, adrPath);
    if (!text) continue;
    for (const diff of diffs) {
      const stepBlob = `${diff.beforeSteps.join(" ")} ${diff.afterSteps.join(" ")}`;
      const matched: string[] = [];
      for (const rule of RULES) {
        const touchesDiff =
          rule.terms.test(diff.detail) ||
          rule.terms.test(diff.title) ||
          rule.terms.test(stepBlob);
        if (touchesDiff && rule.terms.test(text)) {
          matched.push(rule.topic);
        }
      }
      if (
        /payment ordering|charge payment|send confirmation/i.test(
          `${diff.title} ${diff.detail}`,
        ) &&
        /payment|charge|confirm/i.test(text)
      ) {
        if (!matched.includes("payment ordering")) matched.push("payment ordering");
      }
      if (!matched.length) continue;
      conflicts.push({
        adrPath,
        flowId: diff.flowId,
        title: `Conflicts with decision: ${adrPath.split("/").pop()}`,
        detail: `Behavior change on ${diff.flowId} may violate documented ${matched.join(", ")}. Evidence: ${adrPath}.`,
        matchedTerms: [...new Set(matched)],
      });
    }
  }

  return conflicts;
}
