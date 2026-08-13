/**
 * Atlas Sentinel — defensive security API routes.
 * No offensive scanning · no exploit guidance · secrets always redacted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidSchema } from "@atlas/shared";
import { runSentinelScan } from "@atlas/observer";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { resolveObserverWorkspace } from "../services/observe-cycle.js";
import { proposeTruthFindingRemediation } from "../services/remediation-pipeline.js";

export async function registerSentinelRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/projects/:id/sentinel/scan", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000).optional() })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      workspaceRoot: body.workspaceRoot ?? null,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = runSentinelScan(resolved.workspaceRoot);
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
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = runSentinelScan(resolved.workspaceRoot);
    return {
      ...result,
      projectId,
      projectSlug: resolved.projectSlug,
      agent: "Atlas Sentinel",
      mode: "defensive",
    };
  });

  /** S1.5 seed — propose remediation draft (HIGH/CRITICAL apply stays blocked). */
  app.post("/api/v1/projects/:id/sentinel/propose", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const body = z
      .object({
        findingId: z.string().min(1).max(200),
      })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const scan = runSentinelScan(resolved.workspaceRoot);
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

  /** S1.5 seed — verify by re-scanning; finding absence = verified (separate engine). */
  app.post("/api/v1/projects/:id/sentinel/verify", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const body = z
      .object({
        findingId: z.string().min(1).max(200),
      })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const scan = runSentinelScan(resolved.workspaceRoot);
    const still = scan.findings.find((f) => f.id === body.findingId);
    return reply.send({
      findingId: body.findingId,
      verified: !still,
      stillPresent: Boolean(still),
      posture: scan.posture,
      summary: scan.summary,
      scannedAt: scan.scannedAt,
      evidenceRefs: still
        ? [...still.evidenceRefs]
        : [`verify:absent:${body.findingId}`, `scan:${scan.scannedAt}`],
      claim: still ? "OBSERVED" : "OBSERVED",
      note: still
        ? "Finding still present — fix not verified"
        : "Finding absent on re-scan — verification passed (defensive)",
    });
  });
}
