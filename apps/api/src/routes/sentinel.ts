/**
 * Atlas Sentinel — defensive security API routes.
 * No offensive scanning · no exploit guidance · secrets always redacted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { authorizeEntityAction } from "@atlas/agent-core";
import { runSentinelScan, verifySentinelFinding } from "@atlas/observer";
import { resolveObserverWorkspace } from "../services/observe-cycle.js";
import { proposeTruthFindingRemediation } from "../services/remediation-pipeline.js";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
} from "../services/project-access.js";

export async function registerSentinelRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/projects/:id/sentinel/scan", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);

    // Entity-policy gate: security scan is CASE.EXECUTE (triggering analysis).
    const entityDecision = authorizeEntityAction("CASE", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "CASE.EXECUTE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000).optional() })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      workspaceRoot: body.workspaceRoot ?? null,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = runSentinelScan(resolved.workspaceRoot, { persist: true });
    return reply.send({
      ...result,
      projectId,
      projectSlug: resolved.projectSlug,
      agent: "Atlas Sentinel",
      mode: "defensive",
    });
  });

  app.get("/api/v1/projects/:id/sentinel", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = runSentinelScan(resolved.workspaceRoot, { persist: false });
    return {
      ...result,
      projectId,
      projectSlug: resolved.projectSlug,
      agent: "Atlas Sentinel",
      mode: "defensive",
    };
  });

  app.post("/api/v1/projects/:id/sentinel/propose", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        findingId: z.string().min(1).max(200),
      })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const scan = runSentinelScan(resolved.workspaceRoot, { persist: false });
    const finding = scan.findings.find((f) => f.id === body.findingId);
    if (!finding) {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Sentinel finding not present in latest defensive scan",
        },
      });
    }
    const draft = proposeTruthFindingRemediation({
      projectId,
      finding: {
        id: finding.id,
        title: finding.title,
        detail: finding.detail,
        riskBand: finding.severity,
        claim: finding.claim,
        epistemicState: finding.epistemicState,
        evidenceRefs: [...finding.evidenceRefs],
        category: "SENTINEL",
      },
    });
    return reply.status(201).send({
      draft,
      note: draft.applyBlocked
        ? "HIGH/CRITICAL — propose only; apply blocked until human gate"
        : "Draft ready for approve → apply → verify",
      loop: "PROPOSE → APPROVE → APPLY(sandbox) → VERIFY(re-scan)",
    });
  });

  app.post("/api/v1/projects/:id/sentinel/verify", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        findingId: z.string().min(1).max(200),
      })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = verifySentinelFinding(
      resolved.workspaceRoot,
      body.findingId,
    );
    return reply.send(result);
  });
}
