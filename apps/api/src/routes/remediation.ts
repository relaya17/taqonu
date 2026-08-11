import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  applyPatchSchema,
  approvePatchSchema,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import {
  approvePatchArtifact,
  applyApprovedPatch,
  isAutoRemediationDraft,
} from "../services/patch-write.js";

/**
 * Approval-gated AUTO_FIX remediation path — reuses the patch pipeline.
 * Never applies without prior Approve + explicit project workspaceRoot.
 */
export async function registerRemediationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/remediation/drafts", async (request) => {
    const q = z
      .object({
        projectId: uuidSchema.optional(),
        status: z.string().max(40).optional(),
      })
      .parse(request.query ?? {});
    let items = osStore
      .listPatches(q.projectId)
      .filter(isAutoRemediationDraft);
    if (q.status) {
      items = items.filter((p) => p.status === q.status);
    }
    return {
      items,
      page: 1,
      pageSize: items.length,
      total: items.length,
      note: "AUTO_FIX drafts only — Approve then Apply. WRITE stays approval-gated.",
    };
  });

  app.get("/api/v1/remediation/drafts/:id", async (request, reply) => {
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const patch = osStore.getPatch(id);
    if (!patch || !isAutoRemediationDraft(patch)) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Remediation draft not found" },
      });
    }
    return patch;
  });

  app.post(
    "/api/v1/remediation/drafts/:id/approve",
    async (request, reply) => {
      const user = requireSignedInForWrite(app, request);
      const id = z.object({ id: uuidSchema }).parse(request.params).id;
      const body = approvePatchSchema.parse(request.body ?? {});
      const existing = osStore.getPatch(id);
      if (!existing || !isAutoRemediationDraft(existing)) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Remediation draft not found" },
        });
      }
      return approvePatchArtifact(existing, {
        approvedBy: body.approvedBy?.trim() || user.email,
        ...(body.note !== undefined ? { note: body.note } : {}),
        userId: user.id,
      });
    },
  );

  app.post("/api/v1/remediation/drafts/:id/apply", async (request, reply) => {
    const user = requireSignedInForWrite(app, request);
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const body = applyPatchSchema.parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing || !isAutoRemediationDraft(existing)) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Remediation draft not found" },
      });
    }
    if (existing.risk === "HIGH" || existing.risk === "CRITICAL") {
      throw new AtlasError(
        "FORBIDDEN",
        "AUTO_FIX apply path is limited to LOW/MEDIUM drafts",
        { statusCode: 403 },
      );
    }
    return applyApprovedPatch({
      existing,
      user,
      bodyWorkspaceRoot: body.workspaceRoot ?? null,
      requireProjectRoot: true,
    });
  });
}
