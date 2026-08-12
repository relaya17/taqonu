import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  parseEvidenceRecord,
  uuidSchema,
} from "@atlas/shared";
import {
  parseSarifToFindings,
  severityFromSarifLevel,
} from "@atlas/code-intelligence";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { runStateReconciliation } from "../services/state-reconciliation.js";

const bodySchema = z.object({
  projectId: uuidSchema,
  /** Full SARIF document or { runs: [...] } */
  sarif: z.record(z.unknown()),
  toolHint: z.string().max(80).optional(),
});

export async function registerSecuritySarifRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/security/sarif", async (request, reply) => {
    const body = bodySchema.parse(request.body);
    const project = osStore.getProject(body.projectId);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }

    const findings = parseSarifToFindings(
      body.sarif as {
        version?: string;
        runs?: Array<{
          tool?: { driver?: { name?: string } };
          results?: Array<Record<string, unknown>>;
        }>;
      },
    );

    if (findings.length === 0) {
      osStore.appendAudit({
        type: "security.sarif.ingest",
        projectId: body.projectId,
        findingCount: 0,
        note: "INSUFFICIENT_EVIDENCE",
      });
      return reply.status(200).send({
        projectId: body.projectId,
        findingCount: 0,
        evidenceIds: [],
        epistemicState: "INSUFFICIENT_EVIDENCE",
        note: "No SARIF results — nothing invented. Run Semgrep/CodeQL and re-upload.",
      });
    }

    const { ownerId } = await resolveCloudIdentity(app, request);
    const now = new Date().toISOString();
    const evidence = findings.slice(0, 200).map((f) =>
      parseEvidenceRecord({
        id: crypto.randomUUID(),
        ownerId,
        projectId: body.projectId,
        source: `${body.toolHint ?? f.tool}:sarif`,
        sourceType: "CI",
        sourceId: f.ruleId,
        uri: f.file,
        excerpt: f.excerpt,
        version: null,
        observedAt: now,
        createdAt: now,
        confidence: f.level === "error" ? 0.9 : 0.7,
        epistemicState: "FACT",
        category: "SECURITY",
        metadata: {
          ruleId: f.ruleId,
          level: f.level,
          severity: severityFromSarifLevel(f.level),
          startLine: f.startLine,
          tool: f.tool,
          feedRole: "scanner_sarif",
        },
      }),
    );

    osStore.addEvidence(body.projectId, evidence);
    const snapshot = runStateReconciliation(body.projectId);
    osStore.appendAudit({
      type: "security.sarif.ingest",
      projectId: body.projectId,
      findingCount: evidence.length,
    });

    return reply.status(201).send({
      projectId: body.projectId,
      findingCount: evidence.length,
      evidenceIds: evidence.map((e) => e.id),
      snapshotOverall: snapshot.overallEpistemicState,
      note: "SARIF → SECURITY evidence (category preserved). Not a substitute for human triage.",
    });
  });
}
