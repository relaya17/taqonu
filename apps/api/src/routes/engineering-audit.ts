import type { FastifyInstance } from "fastify";
import {
  constitutionReportSchema,
  runConstitutionRequestSchema,
  runContinuousAuditRequestSchema,
  systemHealthReportSchema,
  uuidSchema,
} from "@atlas/shared";
import {
  defaultArchitectureContract,
  draftAutoRemediations,
  listConstitutionChecklist,
  runContinuousSystemAudit,
  runEngineeringConstitution,
} from "@atlas/code-intelligence";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { osStore } from "../store/os-store.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import {
  loadArchitectureContract,
  saveArchitectureContract,
} from "../services/architecture-contract-store.js";
import { architectureContractSchema } from "@atlas/shared";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

const reports: Array<ReturnType<typeof systemHealthReportSchema.parse>> = [];
const constitutionReports: Array<
  ReturnType<typeof constitutionReportSchema.parse>
> = [];

function resolveWorkspace(
  app: FastifyInstance,
  opts: {
    workspaceRoot?: string | undefined;
    projectId?: string | null | undefined;
  },
): string {
  if (opts.projectId) {
    const stored = osStore.getWorkspaceRoot(opts.projectId);
    if (stored) return resolve(stored);
  }
  return (
    opts.workspaceRoot ||
    app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ||
    defaultGoldenRoot()
  );
}

export async function registerEngineeringAuditRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/audit-engine/contract/default", async () => {
    return defaultArchitectureContract(null);
  });

  app.get("/api/v1/audit-engine/contract", async (request) => {
    const q = z
      .object({ projectId: uuidSchema.nullable().optional() })
      .parse(request.query ?? {});
    return loadArchitectureContract(q.projectId ?? null);
  });

  app.put("/api/v1/audit-engine/contract", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = architectureContractSchema.parse(request.body);
    const saved = saveArchitectureContract(body);
    osStore.recordEvent({
      type: "architecture-contract.saved",
      projectId: saved.projectId,
      name: saved.name,
      at: new Date().toISOString(),
    });
    return reply.status(200).send(saved);
  });

  app.get("/api/v1/audit-engine/reports", async () => ({
    items: reports.slice(-20).reverse(),
  }));

  app.get("/api/v1/audit-engine/reports/:id", async (request, reply) => {
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const hit = reports.find((r) => r.id === id);
    if (!hit) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Report not found" },
      });
    }
    return hit;
  });

  app.get("/api/v1/constitution/checklist", async () => ({
    items: listConstitutionChecklist(),
    domains: [
      ...new Set(listConstitutionChecklist().map((i) => i.domain)),
    ],
  }));

  app.get("/api/v1/constitution/reports", async () => ({
    items: constitutionReports.slice(-20).reverse(),
  }));

  app.post("/api/v1/constitution/run", async (request, reply) => {
    const body = runConstitutionRequestSchema.parse(request.body ?? {});
    const project =
      body.projectId != null ? osStore.getProject(body.projectId) : undefined;
    const workspaceRoot = resolveWorkspace(app, {
      ...(body.workspaceRoot !== undefined
        ? { workspaceRoot: body.workspaceRoot }
        : {}),
      projectId: body.projectId ?? project?.id ?? null,
    });
    if (!existsSync(resolve(workspaceRoot))) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: `workspaceRoot not found: ${workspaceRoot}`,
        },
      });
    }

    const report = runEngineeringConstitution({
      workspaceRoot: resolve(workspaceRoot),
      projectId: body.projectId ?? project?.id ?? null,
      projectName: body.projectName ?? project?.name ?? "Repository",
      ...(body.intent ? { intent: body.intent } : {}),
      ...(body.profiles ? { profiles: body.profiles } : {}),
    });
    const parsed = constitutionReportSchema.parse(report);
    constitutionReports.push(parsed);
    if (constitutionReports.length > 50) constitutionReports.shift();

    osStore.recordEvent({
      type: "constitution.run",
      id: parsed.id,
      overall: parsed.overallScore,
      omissions: parsed.omissions.length,
      failed: parsed.results.filter((r) => r.status === "FAIL").length,
      at: parsed.createdAt,
    });
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: parsed.projectId,
      epistemicState: "OBSERVED",
      payload: {
        kind: "engineering-constitution",
        reportId: parsed.id,
        overallScore: parsed.overallScore,
        omissions: parsed.omissions.length,
      },
    });

    return reply.status(201).send(parsed);
  });

  app.post("/api/v1/audit-engine/run", async (request, reply) => {
    const body = runContinuousAuditRequestSchema.parse(request.body ?? {});
    const project =
      body.projectId != null ? osStore.getProject(body.projectId) : undefined;
    const workspaceRoot = resolveWorkspace(app, {
      ...(body.workspaceRoot !== undefined
        ? { workspaceRoot: body.workspaceRoot }
        : {}),
      projectId: body.projectId ?? project?.id ?? null,
    });
    if (!existsSync(resolve(workspaceRoot))) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: `workspaceRoot not found: ${workspaceRoot}`,
        },
      });
    }

    const contract = loadArchitectureContract(
      body.projectId ?? project?.id ?? null,
    );
    const report = runContinuousSystemAudit({
      workspaceRoot: resolve(workspaceRoot),
      projectId: body.projectId ?? project?.id ?? null,
      projectName: body.projectName ?? project?.name ?? "Repository",
      contract,
      ...(body.intent ? { intent: body.intent } : {}),
      includeConstitution: body.includeConstitution ?? true,
    });
    const parsed = systemHealthReportSchema.parse(report);
    reports.push(parsed);
    if (reports.length > 50) reports.shift();

    const drafts = draftAutoRemediations({
      projectId: parsed.projectId,
      issues: parsed.issues,
      workspaceRoot: resolve(workspaceRoot),
    });
    for (const d of drafts) {
      osStore.upsertPatch(d.patch);
      appendDomainEvent({
        type: "patch.proposed",
        projectId: d.patch.projectId,
        epistemicState: "PROPOSED",
        payload: {
          kind: "auto-remediation",
          patchId: d.patch.id,
          issueId: d.issueId,
          remediationPolicy: d.remediationPolicy,
          title: d.title,
        },
      });
    }

    osStore.recordEvent({
      type: "audit-engine.run",
      id: parsed.id,
      overall: parsed.overallScore,
      critical: parsed.criticalIssues,
      drift: parsed.driftFindings.length,
      constitution: parsed.constitution?.overallScore ?? null,
      autoRemediationDrafts: drafts.length,
      at: parsed.createdAt,
    });
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: parsed.projectId,
      epistemicState: "OBSERVED",
      payload: {
        kind: "continuous-system-audit",
        reportId: parsed.id,
        overallScore: parsed.overallScore,
        criticalIssues: parsed.criticalIssues,
        constitutionScore: parsed.constitution?.overallScore ?? null,
        autoRemediationDrafts: drafts.length,
      },
    });

    return reply.status(201).send({
      ...parsed,
      autoRemediationDrafts: drafts.map((d) => ({
        issueId: d.issueId,
        patchId: d.patch.id,
        title: d.title,
        note: d.note,
        remediationPolicy: d.remediationPolicy,
        status: d.patch.status,
      })),
    });
  });
}
