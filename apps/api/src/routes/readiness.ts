import type { FastifyInstance } from "fastify";
import { issueCertificateSchema } from "@atlas/shared";
import { issueProductionReadinessCertificate } from "../services/readiness-certificate.js";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { defaultGoldenRoot } from "../services/golden-root.js";

export async function registerReadinessRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/readiness/certificate", async (request, reply) => {
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
        unknownClaims: cert.unknownClaims,
      },
    });
    osStore.appendAudit({
      type: "readiness.certificate.issued",
      certificateId: cert.id,
      overallScore: cert.overallScore,
      at: cert.createdAt,
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
