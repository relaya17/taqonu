import type { FastifyInstance } from "fastify";
import {
  createDecisionSchema,
  decisionSchema,
  transitionDecisionSchema,
  type Decision,
} from "@atlas/shared";
import { tryPersistDecisionToSupabase } from "@atlas/database";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { requireUser } from "../middleware/auth-guards.js";
import {
  assertEntityReadAccess,
  canReadProjectScoped,
} from "../services/project-access.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

const listQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "SUPERSEDED", "PROPOSED", "REJECTED"]).optional(),
});

function allowedTransitions(from: Decision["status"]): Decision["status"][] {
  switch (from) {
    case "PROPOSED":
      return ["ACTIVE", "REJECTED", "SUPERSEDED"];
    case "ACTIVE":
      return ["SUPERSEDED", "REJECTED"];
    case "REJECTED":
    case "SUPERSEDED":
      return [];
    default:
      return [];
  }
}

function epistemicForStatus(
  status: Decision["status"],
  previous: Decision["epistemicState"],
): Decision["epistemicState"] {
  if (status === "ACTIVE") return "CONFIRMED";
  if (status === "REJECTED") return "CONFLICTED";
  if (status === "SUPERSEDED") return previous === "CONFIRMED" ? "CONFIRMED" : "PROPOSED";
  return previous;
}

/**
 * Trust ranking for the epistemic ladder (mirrors `EPISTEMIC_TRUST_RANK` in
 * packages/shared/src/schemas/memory.schema.ts). States outside this table
 * are negative/error states (CONTRADICTED, STALE, UNKNOWN, CONFLICTED,
 * INSUFFICIENT_EVIDENCE) rather than claims of certainty, so they're left
 * out and pass through the cap below unchanged.
 */
const EPISTEMIC_TRUST_RANK: Partial<Record<Decision["epistemicState"], number>> = {
  UNVERIFIED: 1,
  ASSUMED: 1,
  PROPOSED: 1,
  INFERRED: 2,
  OBSERVED: 3,
  CONFIRMED: 4,
  VERIFIED: 5,
  FACT: 5,
};

/**
 * FACT-assertion poisoning gate at create time, scoped to this route.
 *
 * `body.epistemicState` on POST /decisions is a self-reported claim from
 * whoever calls this endpoint — nothing about it is verified at this
 * boundary. Unlike `Memory` (see `capEpistemicStateForSource()` in
 * memory.schema.ts), `Decision` has no `sourceType`/trust-tier concept to
 * key a per-source ceiling off of, so instead we use a single flat ceiling:
 * no client-supplied (or client-omitted-but-defaulted) epistemicState may
 * claim above PROPOSED — the lowest, pending-review tier — at creation
 * time. This also closes the previous default of jumping straight to
 * CONFIRMED whenever `status === "ACTIVE"` with no client input at all. The
 * only sanctioned path to CONFIRMED is the server-driven
 * POST /decisions/:id/transition → ACTIVE flow (`epistemicForStatus`
 * above), which never reads client-supplied epistemicState.
 */
const CREATE_EPISTEMIC_CEILING: Decision["epistemicState"] = "PROPOSED";

function capEpistemicStateAtCreate(
  requested: Decision["epistemicState"],
): Decision["epistemicState"] {
  const requestedRank = EPISTEMIC_TRUST_RANK[requested];
  if (requestedRank === undefined) return requested;
  const ceilingRank = EPISTEMIC_TRUST_RANK[CREATE_EPISTEMIC_CEILING]!;
  return requestedRank > ceilingRank ? CREATE_EPISTEMIC_CEILING : requested;
}


export async function registerDecisionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/decisions", async (request) => {
    const user = await requireUser(app, request);
    const query = listQuerySchema.parse(request.query ?? {});
    if (query.projectId) {
      await assertEntityReadAccess(app, request, query.projectId);
    }
    let items = osStore.listDecisions();
    if (query.projectId) {
      items = items.filter((d) => d.projectId === query.projectId);
    } else {
      items = items.filter((d) => canReadProjectScoped(user, d.projectId));
    }
    if (query.status) {
      items = items.filter((d) => d.status === query.status);
    }
    items = [...items].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return {
      items,
      page: 1,
      pageSize: items.length || 20,
      total: items.length,
    };
  });

  app.get("/api/v1/decisions/:id", async (request, reply) => {
    await requireUser(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const decision = osStore.getDecision(id);
    if (!decision) {
      return reply.status(404).send({ error: "Decision not found" });
    }
    await assertEntityReadAccess(app, request, decision.projectId);
    return decision;
  });

  app.post("/api/v1/decisions", async (request, reply) => {
    const user = await requireUser(app, request);
    const body = createDecisionSchema.parse(request.body);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "decisions.create",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });
    const now = new Date().toISOString();
    const status = body.status ?? "PROPOSED";
    const rawEpistemicState =
      body.epistemicState ?? (status === "ACTIVE" ? "CONFIRMED" : "PROPOSED");
    const decision = decisionSchema.parse({
      id: crypto.randomUUID(),
      projectId: body.projectId ?? null,
      decision: body.decision,
      reason: body.reason ?? [],
      alternatives: body.alternatives ?? [],
      tradeOffs: body.tradeOffs ?? [],
      evidence: body.evidence ?? [],
      status,
      confidence: body.confidence ?? (status === "ACTIVE" ? 1 : 0.6),
      epistemicState: capEpistemicStateAtCreate(rawEpistemicState),
      supersededBy: null,
      adrPath: body.adrPath ?? null,
      decidedAt: body.decidedAt ?? now,
      createdAt: now,
      updatedAt: now,
    });
    osStore.addDecision(decision);
    osStore.recordEvent({
      type: "decision.created",
      decisionId: decision.id,
      projectId: decision.projectId,
      status: decision.status,
      occurredAt: now,
    });

    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
    const cloudSynced = Boolean(
      await tryPersistDecisionToSupabase(app.atlasEnv, decision, identity.ownerId, {
        userAccessToken: identity.userAccessToken,
      }),
    );

    return reply.status(201).send({ ...decision, cloudSynced });
  });

  app.post("/api/v1/decisions/:id/transition", async (request, reply) => {
    const user = await requireUser(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = transitionDecisionSchema.parse(request.body);
    const existing = osStore.getDecision(id);
    if (!existing) {
      return reply.status(404).send({ error: "Decision not found" });
    }
    enforceEntityWrite({
      entityType: "RECORD",
      action: "UPDATE",
      routeLabel: "decisions.transition",
      actorId: user.id,
      projectId: existing.projectId ?? null,
    });

    const allowed = allowedTransitions(existing.status);
    if (!allowed.includes(body.status)) {
      return reply.status(409).send({
        error: `Cannot transition from ${existing.status} to ${body.status}`,
        allowed,
      });
    }

    if (body.status === "SUPERSEDED") {
      const successor = osStore.getDecision(body.supersededBy!);
      if (!successor) {
        return reply.status(400).send({ error: "supersededBy decision not found" });
      }
      if (successor.id === existing.id) {
        return reply.status(400).send({ error: "Decision cannot supersede itself" });
      }
    }

    const now = new Date().toISOString();
    const reason =
      body.reason && body.reason.trim().length > 0
        ? [...existing.reason, body.reason.trim()]
        : existing.reason;

    const updated = decisionSchema.parse({
      ...existing,
      status: body.status,
      supersededBy: body.status === "SUPERSEDED" ? body.supersededBy! : existing.supersededBy,
      reason,
      epistemicState: epistemicForStatus(body.status, existing.epistemicState),
      confidence:
        body.status === "ACTIVE"
          ? Math.max(existing.confidence, 0.85)
          : existing.confidence,
      decidedAt: body.status === "ACTIVE" ? now : existing.decidedAt,
      updatedAt: now,
    });

    osStore.updateDecision(updated);
    osStore.recordEvent({
      type: "decision.transitioned",
      decisionId: updated.id,
      projectId: updated.projectId,
      from: existing.status,
      to: updated.status,
      supersededBy: updated.supersededBy,
      occurredAt: now,
    });

    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
    const cloudSynced = Boolean(
      await tryPersistDecisionToSupabase(app.atlasEnv, updated, identity.ownerId, {
        userAccessToken: identity.userAccessToken,
      }),
    );

    return { ...updated, cloudSynced };
  });
}
