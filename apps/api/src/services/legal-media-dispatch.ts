import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runLegalMediaReview } from "@atlas/code-intelligence";
import {
  agentRunResultSchema,
  type AgentRunResult,
} from "@atlas/shared";
import { resolveProjectWorkspaceRoot } from "./security-sentinel-dispatch.js";

/** LEGAL_MEDIA_COMMS fabric run backed by the counsel-prep review — not legal advice. */
export function runLegalMediaSpecialistViaReview(input: {
  request: string;
  projectId?: string | null;
  workspaceRoot?: string | null;
}): AgentRunResult {
  const root =
    input.workspaceRoot && existsSync(input.workspaceRoot)
      ? resolve(input.workspaceRoot)
      : resolveProjectWorkspaceRoot(input.projectId ?? null);
  const started = Date.now();
  const review = runLegalMediaReview({
    projectId: input.projectId ?? null,
    workspaceRoot: root,
  });
  const top = review.findings.slice(0, 8);
  const claims = [
    `LEGAL_MEDIA_COMMS: readiness=${review.lawyerReadiness}`,
    "WRITE=forbidden",
    "give_legal_advice=forbidden",
    "notALawyer=true",
    `sources=${review.verifiedSources.length}`,
    ...top.map((f) => `${f.status} ${f.title}`),
    ...review.counselTopics.slice(0, 5),
  ];
  return agentRunResultSchema.parse({
    agentId: "LEGAL_MEDIA_COMMS",
    status: "COMPLETED",
    summary: `${review.lawyerReadiness}: ${review.summaryEn}`,
    claims,
    evidenceRefs: [
      ...top.flatMap((f) => f.evidenceRefs.slice(0, 2)),
      ...review.verifiedSources.slice(0, 8).map((s) => s.id),
    ],
    epistemicState: review.epistemicState,
    costUsd: 0,
    durationMs: Math.max(1, Date.now() - started),
  });
}
