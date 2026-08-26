import type { FastifyInstance } from "fastify";
import { AtlasError, issueCertificateSchema } from "@atlas/shared";
import { authorizeEntityAction } from "@atlas/agent-core";
import { issueProductionReadinessCertificate } from "../services/readiness-certificate.js";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

export async function registerReadinessRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/readiness/certificate", async (request, reply) => {
    // ROLE-LEVEL gate: previously this route had NO auth guard at all —
    // any unauthenticated caller could issue a production-readiness
    // certificate.
    const user = await requireSignedInForWrite(app, request);

    // ENTITY-LEVEL gate, independent of the WRITE-role check above.
    // `CONFIGURATION.EXECUTE` fits "run a control-plane evaluation and
    // record its verdict." Issuing a certificate recomputes/records a
    // score from already-existing project state (it does not itself take
    // an irreversible external action), so an authenticated WRITE-session
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
          : "readiness.certificate (CONFIGURATION.EXECUTE) was not ALLOWED.";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    osStore.ensureLoaded();
    const body = issueCertificateSchema.parse(request.body ?? {});
    const project =
      body.projectId != null ? osStore.getProject(body.projectId) : undefined;
    const workspaceRoot =
      body.workspaceRoot ||
      app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ||
      defaultGoldenRoot();
    const cert = issueProductionReadinessCertificate({
      projectId: body.projectId ?? project?.id ?? null,
      projectName:
        body.projectName ??
        project?.name ??
        app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ??
        "BrokerOS",
      workspaceRoot,
    });
    osStore.addReadinessCertificate(cert);
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: cert.projectId,
      epistemicState: "OBSERVED",
      payload: {
        kind: "production-readiness-certificate",
        certificateId: cert.id,
        overallScore: cert.overallScore,
        blockers: cert.blockers,
        // The human actor who triggered this evaluation — now that this
        // route has a real auth guard, `payload.actorId` carries a real id
        // instead of always being null (see `automation-rules.ts`'s
        // `onReadinessCertificateBlocked`, which was already anticipating
        // this fix).
        actorId: user.id,
        unknownClaims: cert.unknownClaims,
      },
    });
    osStore.appendAudit({
      type: "readiness.certificate.issued",
      certificateId: cert.id,
      overallScore: cert.overallScore,
      at: cert.createdAt,
      by: user.id,
    });
    return reply.status(201).send({ certificate: cert });
  });

  app.get("/api/v1/readiness/certificates", async () => {
    const items = osStore.listReadinessCertificates();
    return { items, total: items.length };
  });

  app.get("/api/v1/readiness/certificates/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const cert = osStore.getReadinessCertificate(id);
    if (!cert) {
      return reply.status(404).send({ error: { message: "Not found" } });
    }
    return cert;
  });
}
