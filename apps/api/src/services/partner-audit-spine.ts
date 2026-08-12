import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runContinuousSystemAudit } from "@atlas/code-intelligence";
import {
  systemHealthReportSchema,
  uuidSchema,
  type SystemHealthReport,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { buildAtlasVerdict } from "./atlas-verdict.js";
import { issueProductionReadinessCertificate } from "./readiness-certificate.js";
import { loadArchitectureContract } from "./architecture-contract-store.js";
import { appendDomainEvent } from "./memory-pipeline.js";
import { defaultGoldenRoot } from "./golden-root.js";

export const partnerAuditSpineRequestSchema = z.object({
  projectId: uuidSchema,
  intent: z.string().max(500).optional(),
  includeConstitution: z.boolean().optional().default(true),
  /** When true (default), persist a readiness certificate for /readiness deep link. */
  issueCertificate: z.boolean().optional().default(true),
});

export type PartnerAuditSpineRequest = z.infer<
  typeof partnerAuditSpineRequestSchema
>;

export interface PartnerAuditSpineResult {
  projectId: string;
  projectName: string;
  projectSlug: string;
  workspaceRoot: string | null;
  auditSkipped: boolean;
  auditSkipReason: string | null;
  verdict: {
    status: string;
    productionReadiness: number;
    criticalBlockers: number;
    highRisks: number;
    unverifiedClaims: number;
    plainLanguageSummary: string;
    certificateId: string | null;
  };
  health: {
    reportId: string | null;
    overallScore: number | null;
    criticalIssues: number | null;
    highRisk: number | null;
    constitutionScore: number | null;
    plainLanguageSummary: string | null;
  };
  readiness: {
    certificateId: string | null;
    overallScore: number | null;
    blockers: string[];
    unknownClaims: number | null;
  };
  links: {
    verdict: string;
    health: string;
    readiness: string;
    projects: string;
  };
  checklistMarkdown: string;
  checklistJson: Record<string, unknown>;
  note: string;
}

export type RecordHealthReportFn = (report: SystemHealthReport) => void;

function resolveProjectWorkspace(
  projectId: string,
  envGoldenRoot: string | undefined,
): { root: string | null; reason: string | null } {
  const stored = osStore.getWorkspaceRoot(projectId);
  if (stored) {
    const root = resolve(stored);
    if (existsSync(root)) return { root, reason: null };
    return {
      root: null,
      reason: `Stored workspaceRoot not found on disk: ${root}`,
    };
  }
  const golden = envGoldenRoot || defaultGoldenRoot();
  if (golden && existsSync(resolve(golden))) {
    return { root: resolve(golden), reason: null };
  }
  return {
    root: null,
    reason:
      "No workspaceRoot linked for this project — set one via PUT /api/v1/projects/:id/workspace-root or re-import local.",
  };
}

export function buildPartnerChecklist(input: {
  projectName: string;
  projectSlug: string;
  projectId: string;
  at: string;
  verdictStatus: string;
  productionReadiness: number;
  criticalBlockers: number;
  highRisks: number;
  unverifiedClaims: number;
  healthScore: number | null;
  constitutionScore: number | null;
  criticalIssues: number | null;
  certificateId: string | null;
  healthReportId: string | null;
  auditSkipped: boolean;
  auditSkipReason: string | null;
  workspaceRoot: string | null;
}): { markdown: string; json: Record<string, unknown> } {
  const json = {
    kind: "design-partner-audit-spine",
    capturedAt: input.at,
    project: {
      id: input.projectId,
      name: input.projectName,
      slug: input.projectSlug,
      workspaceRoot: input.workspaceRoot,
    },
    verdict: {
      status: input.verdictStatus,
      productionReadiness: input.productionReadiness,
      criticalBlockers: input.criticalBlockers,
      highRisks: input.highRisks,
      unverifiedClaims: input.unverifiedClaims,
    },
    health: {
      overallScore: input.healthScore,
      constitutionScore: input.constitutionScore,
      criticalIssues: input.criticalIssues,
      reportId: input.healthReportId,
      skipped: input.auditSkipped,
      skipReason: input.auditSkipReason,
    },
    readiness: {
      certificateId: input.certificateId,
    },
    links: {
      verdict: "/",
      health: "/health",
      readiness: "/readiness",
      projects: "/projects",
    },
    successChecks: {
      unknownHighOrCritical: false,
      blockerMadeExplicit: input.criticalBlockers > 0,
      certificateAndVerdictWithEvidence: true,
      healthRunOrSkipReason: !input.auditSkipped || Boolean(input.auditSkipReason),
      quoteOrDecline: false,
      publishPermission: false,
      continuePauseExpand: false,
    },
  };

  const healthLine = input.auditSkipped
    ? `- Health: skipped — ${input.auditSkipReason ?? "no workspace"}`
    : `- Health score: ${input.healthScore ?? "—"}/100 · constitution ${input.constitutionScore ?? "—"} · critical issues ${input.criticalIssues ?? 0}`;

  const markdown = [
    `# Design Partner — Audit spine summary`,
    ``,
    `- Captured: ${input.at}`,
    `- Project: **${input.projectName}** (\`${input.projectSlug}\` / \`${input.projectId}\`)`,
    input.workspaceRoot ? `- Workspace: \`${input.workspaceRoot}\`` : `- Workspace: _(not linked)_`,
    ``,
    `## Snapshot`,
    `- Verdict: **${input.verdictStatus}** · readiness ${input.productionReadiness}/100`,
    `- Blockers: ${input.criticalBlockers} · high risks: ${input.highRisks} · unverified claims: ${input.unverifiedClaims}`,
    healthLine,
    `- Certificate id: ${input.certificateId ?? "_(not issued)_"}`,
    input.healthReportId ? `- Health report id: \`${input.healthReportId}\`` : null,
    ``,
    `## Deep links (in-app)`,
    `- Verdict (home): \`/\``,
    `- System Health: \`/health\``,
    `- Readiness Certificate: \`/readiness\``,
    `- Projects: \`/projects\``,
    ``,
    `## Success metrics (fill during readout)`,
    `- [ ] Unknown HIGH/CRITICAL surfaced`,
    `- [ ] Blocker made explicit to champion`,
    `- [ ] Certificate + Verdict walked with Evidence`,
    `- [ ] Health run completed (or skip reason recorded)`,
    `- [ ] Quote or decline captured`,
    `- [ ] Publish permission (yes/no/anonymized)`,
    `- [ ] Decision: continue / pause / expand`,
    ``,
    `## Capture next`,
    `- Fill \`docs/case-studies/_partner-fill-in.md\``,
    `- Log slot in \`docs/strategy/design-partner-tracker.md\` (no invented names)`,
    `- No email automation — outreach stays human`,
    ``,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { markdown, json };
}

export function runPartnerAuditSpine(input: {
  projectId: string;
  intent?: string | undefined;
  includeConstitution?: boolean | undefined;
  issueCertificate?: boolean | undefined;
  envGoldenRoot?: string | undefined;
  recordHealthReport?: RecordHealthReportFn | undefined;
}): PartnerAuditSpineResult {
  osStore.ensureLoaded();
  const project = osStore.getProject(input.projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const { root, reason } = resolveProjectWorkspace(
    project.id,
    input.envGoldenRoot,
  );

  let healthReport: SystemHealthReport | null = null;
  let auditSkipped = false;
  let auditSkipReason: string | null = null;

  if (!root) {
    auditSkipped = true;
    auditSkipReason = reason;
  } else {
    const contract = loadArchitectureContract(project.id);
    const raw = runContinuousSystemAudit({
      workspaceRoot: root,
      projectId: project.id,
      projectName: project.name,
      contract,
      ...(input.intent ? { intent: input.intent } : {}),
      includeConstitution: input.includeConstitution ?? true,
    });
    healthReport = systemHealthReportSchema.parse(raw);
    input.recordHealthReport?.(healthReport);
    osStore.recordEvent({
      type: "audit-engine.run",
      id: healthReport.id,
      overall: healthReport.overallScore,
      critical: healthReport.criticalIssues,
      drift: healthReport.driftFindings.length,
      constitution: healthReport.constitution?.overallScore ?? null,
      via: "partners.audit-spine",
      at: healthReport.createdAt,
    });
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: project.id,
      epistemicState: "OBSERVED",
      payload: {
        kind: "design-partner-audit-spine",
        reportId: healthReport.id,
        overallScore: healthReport.overallScore,
        criticalIssues: healthReport.criticalIssues,
        constitutionScore: healthReport.constitution?.overallScore ?? null,
      },
    });
  }

  const verdict = buildAtlasVerdict({
    projectId: project.id,
    workspaceRoot: root,
  });

  let certificateId: string | null = verdict.certificateId ?? null;
  let certBlockers: string[] = [];
  let certUnknown: number | null = null;
  let certScore: number | null = verdict.productionReadiness;

  if (input.issueCertificate !== false) {
    const cert = issueProductionReadinessCertificate({
      projectId: project.id,
      projectName: project.name,
      workspaceRoot: root,
    });
    osStore.addReadinessCertificate(cert);
    osStore.incrementUsage("certificatesIssued");
    certificateId = cert.id;
    certBlockers = cert.blockerSummaries ?? [];
    certUnknown = cert.unknownClaims ?? null;
    certScore = cert.overallScore;
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: project.id,
      epistemicState: "OBSERVED",
      payload: {
        kind: "production-readiness-certificate",
        certificateId: cert.id,
        overallScore: cert.overallScore,
        via: "partners.audit-spine",
      },
    });
  }

  osStore.incrementUsage("designPartnerSessions");

  const at = new Date().toISOString();
  const { markdown, json } = buildPartnerChecklist({
    projectName: project.name,
    projectSlug: project.slug,
    projectId: project.id,
    at,
    verdictStatus: verdict.status,
    productionReadiness: verdict.productionReadiness,
    criticalBlockers: verdict.criticalBlockers,
    highRisks: verdict.highRisks,
    unverifiedClaims: verdict.unverifiedClaims,
    healthScore: healthReport?.overallScore ?? null,
    constitutionScore: healthReport?.constitution?.overallScore ?? null,
    criticalIssues: healthReport?.criticalIssues ?? null,
    certificateId,
    healthReportId: healthReport?.id ?? null,
    auditSkipped,
    auditSkipReason,
    workspaceRoot: root,
  });

  return {
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
    workspaceRoot: root,
    auditSkipped,
    auditSkipReason,
    verdict: {
      status: verdict.status,
      productionReadiness: verdict.productionReadiness,
      criticalBlockers: verdict.criticalBlockers,
      highRisks: verdict.highRisks,
      unverifiedClaims: verdict.unverifiedClaims,
      plainLanguageSummary: verdict.plainLanguageSummary,
      certificateId,
    },
    health: {
      reportId: healthReport?.id ?? null,
      overallScore: healthReport?.overallScore ?? null,
      criticalIssues: healthReport?.criticalIssues ?? null,
      highRisk: healthReport?.highRisk ?? null,
      constitutionScore: healthReport?.constitution?.overallScore ?? null,
      plainLanguageSummary: healthReport?.plainLanguageSummary ?? null,
    },
    readiness: {
      certificateId,
      overallScore: certScore,
      blockers: certBlockers,
      unknownClaims: certUnknown,
    },
    links: {
      verdict: "/",
      health: "/health",
      readiness: "/readiness",
      projects: "/projects",
    },
    checklistMarkdown: markdown,
    checklistJson: json,
    note: auditSkipped
      ? "Verdict + readiness captured; health audit skipped until a local workspaceRoot is linked."
      : "Audit spine complete — open Verdict, Health, and Readiness; copy the checklist for the champion readout.",
  };
}
