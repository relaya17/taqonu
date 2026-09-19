import type { FastifyInstance } from "fastify";
import {
  evaluateGatesRequestSchema,
  uuidSchema,
  waiveGateSchema,
  AtlasError,
  type AuthUser,
} from "@atlas/shared";
import { authorizeEntityAction } from "@atlas/agent-core";
import { z } from "zod";
import { evaluateReleaseGateGraph } from "../services/gate-engine.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import {
  assertProjectReadAccess,
  filterProjectsForCaller,
} from "../services/project-access.js";

function callerReadableProjectIds(user: AuthUser): string[] {
  return filterProjectsForCaller(user, osStore.listProjects()).map(
    (project) => project.id,
  );
}

export async function registerGateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/gates", async (request) => {
    const q = z
      .object({ projectId: uuidSchema.optional() })
      .parse(request.query ?? {});
    if (q.projectId) {
      await assertProjectReadAccess(app, request, q.projectId);
      const existing = osStore.getGateGraph(q.projectId);
      const graph = existing ?? evaluateReleaseGateGraph(q.projectId);
      return { graph };
    }

    // Portfolio: always recompute for this caller. The null-key store row
    // is a single shared graph and cannot represent two callers' readable
    // sets, so it is never served here.
    const user = await requireUser(app, request);
    const graph = evaluateReleaseGateGraph(null, {
      scopedProjectIds: callerReadableProjectIds(user),
    });
    return { graph };
  });

  app.post("/api/v1/gates/evaluate", async (request, reply) => {
    // ROLE-LEVEL gate: previously this route had NO auth guard at all —
    // any unauthenticated caller could trigger a release-gate evaluation.
    const user = await requireSignedInForWrite(app, request);
    const body = evaluateGatesRequestSchema.parse(request.body ?? {});

    // ENTITY-LEVEL gate, independent of the WRITE-role check above.
    // `CONFIGURATION.EXECUTE` fits "run a control-plane evaluation that can
    // block a release." Evaluating gates recomputes status from
    // already-existing project data (it does not itself perform an
    // irreversible external action), so an authenticated WRITE-session
    // caller's own request is treated as sufficient authorization — no
    // separate human-approval round trip is manufactured for it.
    const entityAuthz = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityAuthz.decision !== "ALLOWED") {
      const reason =
        entityAuthz.decision === "DENIED"
          ? entityAuthz.reason
          : "gates.evaluate (CONFIGURATION.EXECUTE) was not ALLOWED.";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const projectId = body.projectId ?? null;
    if (projectId) {
      await assertProjectReadAccess(app, request, projectId);
    }
    const graph = evaluateReleaseGateGraph(projectId, {
      scopedProjectIds:
        projectId == null ? callerReadableProjectIds(user) : [projectId],
    });
    appendDomainEvent({
      type: "gate.evaluated",
      projectId,
      epistemicState: "OBSERVED",
      payload: {
        graphId: graph.id,
        summary: graph.plainLanguageSummary,
        statuses: Object.fromEntries(graph.nodes.map((n) => [n.id, n.status])),
        // The human actor who triggered this evaluation — now that this
        // route has a real auth guard, `payload.actorId` carries a real id
        // instead of always being null (see `automation-rules.ts`'s
        // `onGateBlocked`, which was already anticipating this fix).
        actorId: user.id,
      },
    });
    return reply.status(200).send({ graph });
  });

  app.post("/api/v1/gates/:graphId/waive", async (request, reply) => {
    // ROLE-LEVEL gate: previously this route had NO auth guard at all.
    await requireSignedInForWrite(app, request);
    const params = z.object({ graphId: uuidSchema }).parse(request.params);
    const body = waiveGateSchema.parse(request.body);

    // ENTITY-LEVEL gate: waiving a gate mutates an existing gate node's
    // status to bypass a release blocker. The request body already
    // requires an explicit `waivedBy` + `reason`, i.e. the caller is
    // self-declaring the justification for this specific override, so an
    // authenticated WRITE-session caller's own request is treated as
    // sufficient authorization here (no separate human-approval round
    // trip is manufactured for it).
    const entityAuthz = authorizeEntityAction("CONFIGURATION", "UPDATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityAuthz.decision !== "ALLOWED") {
      const reason =
        entityAuthz.decision === "DENIED"
          ? entityAuthz.reason
          : "gates.waive (CONFIGURATION.UPDATE) was not ALLOWED.";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const graph = osStore.getGateGraphById(params.graphId);
    if (!graph) {
      throw new AtlasError("NOT_FOUND", "Gate graph not found");
    }
    const now = new Date().toISOString();
    const nodes = graph.nodes.map((n) =>
      n.id === body.gateId
        ? {
            ...n,
            status: "WAIVED" as const,
            waivedBy: body.waivedBy,
            waivedReason: body.reason,
            blockerReason: body.reason,
            updatedAt: now,
          }
        : n,
    );
    const next = {
      ...graph,
      nodes,
      plainLanguageSummary: `Gate ${body.gateId} waived by ${body.waivedBy}: ${body.reason}`,
      updatedAt: now,
    };
    osStore.upsertGateGraph(next);
    return reply.status(200).send({ graph: next });
  });
}
