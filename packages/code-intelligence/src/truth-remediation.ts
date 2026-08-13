/**
 * TRUTH-10 · 1.1 — propose remediation from Observer/Truth findings.
 * Always human-gated for HIGH/CRITICAL; LOW may use existing auto-apply gates.
 * Writes a note under `.atlas/remediation/` only — no silent code rewrites.
 */
import { createHash } from "node:crypto";
import type { PatchArtifact } from "@atlas/shared";
import { patchArtifactSchema } from "@atlas/shared";
import { remediationNotePath } from "./auto-remediation.js";

export interface TruthFindingProposeInput {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly riskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
  readonly claim?: string;
  readonly epistemicState?: string;
  readonly evidenceRefs?: readonly string[];
  readonly category?: string;
}

export interface TruthRemediationDraft {
  readonly findingId: string;
  readonly patch: PatchArtifact;
  readonly autoApplyEligible: boolean;
  readonly applyBlocked: boolean;
  readonly note: string;
}

/** Stable UUID for patch.sourceIssueId (schema requires uuid). */
export function truthFindingSourceIssueId(findingId: string): string {
  const h = createHash("sha256")
    .update(`atlas-truth-finding:${findingId}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function mapRisk(
  band: string,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const u = band.toUpperCase();
  if (u === "CRITICAL") return "CRITICAL";
  if (u === "HIGH") return "HIGH";
  if (u === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function truthNoteBody(input: {
  finding: TruthFindingProposeInput;
  workspaceRoot: string;
  now: string;
  applyBlocked: boolean;
}): string {
  const refs = input.finding.evidenceRefs?.length
    ? input.finding.evidenceRefs.map((r) => `- ${r}`).join("\n")
    : "- (none attached)";
  return [
    `# Truth remediation draft`,
    "",
    `Finding: ${input.finding.title}`,
    `Finding ID: ${input.finding.id}`,
    `Risk: ${input.finding.riskBand}`,
    `Claim: ${input.finding.claim ?? "n/a"}`,
    `Epistemic: ${input.finding.epistemicState ?? "n/a"}`,
    `Category: ${input.finding.category ?? "n/a"}`,
    `Workspace: ${input.workspaceRoot}`,
    "",
    `## Detail`,
    input.finding.detail,
    "",
    `## Evidence`,
    refs,
    "",
    `## Loop`,
    `Change → Impact → Evidence → Risk → Verification`,
    "",
    input.applyBlocked
      ? `_HIGH/CRITICAL — recommendation only. Approve for tracking; apply path blocked until a human patch is authored._`
      : `_Requires human Approve before Apply. LOW may auto-apply only with ATLAS_AUTO_APPLY_LOW + WRITE._`,
    `_Generated ${input.now} from Atlas Truth. No cross-tenant learning._`,
  ].join("\n");
}

export function draftTruthFindingRemediation(input: {
  readonly projectId: string | null;
  readonly workspaceRoot: string;
  readonly finding: TruthFindingProposeInput;
  readonly existingSourceIssueIds?: ReadonlySet<string>;
}): TruthRemediationDraft | null {
  const findingId = input.finding.id.trim();
  if (!findingId || !input.finding.title.trim()) return null;
  const sourceIssueId = truthFindingSourceIssueId(findingId);
  if (
    input.existingSourceIssueIds?.has(findingId) ||
    input.existingSourceIssueIds?.has(sourceIssueId)
  ) {
    return null;
  }

  const risk = mapRisk(input.finding.riskBand);
  const applyBlocked = risk === "HIGH" || risk === "CRITICAL";
  const autoApplyEligible = risk === "LOW";
  const now = new Date().toISOString();
  const notePath = remediationNotePath(`truth-${sourceIssueId}`);
  const afterContent = truthNoteBody({
    finding: input.finding,
    workspaceRoot: input.workspaceRoot,
    now,
    applyBlocked,
  });

  const patch = patchArtifactSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    title: `TRUTH_FIX: ${input.finding.title}`.slice(0, 200),
    reason: input.finding.detail.slice(0, 4000),
    mode: "generate",
    status: "AWAITING_APPROVAL",
    risk,
    baseCommit: null,
    targetBranch: null,
    filesChanged: [
      {
        path: notePath,
        action: "add",
        summary: `Truth remediation note for ${findingId}`,
        afterContent,
      },
    ],
    evidenceIds: [],
    claimIds: [],
    expectedImpact:
      `Propose verification/fix path for Truth finding: ${input.finding.title}`.slice(
        0,
        2000,
      ),
    tests: [],
    evaluationSummary: applyBlocked
      ? `Truth finding ${findingId} is ${risk} — recommendation draft only; apply blocked.`
      : `Truth finding ${findingId} drafted for approve→apply→verify.`,
    sourceIssueId,
    approvals: [],
    appliedAt: null,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "atlas-truth-remediation",
    epistemicState: "PROPOSED",
    confidence: 0.4,
    authorityHint: "LLM_INFERENCE",
  });

  return {
    findingId,
    patch,
    autoApplyEligible,
    applyBlocked,
    note: applyBlocked
      ? "HIGH/CRITICAL recommendation — apply blocked"
      : autoApplyEligible
        ? "LOW Truth draft — gated auto-apply eligible when policy allows"
        : "MEDIUM Truth draft — human approve required",
  };
}
