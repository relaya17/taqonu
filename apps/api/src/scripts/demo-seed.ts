/**
 * Demo seed — populates a Design-Partner-ready project with sample evidence,
 * memories, and a Vercel-style deployment observation (local store only).
 *
 * Usage: pnpm demo:seed
 * Does not invent FACT without labels — sample rows use OBSERVED/INFERRED.
 */
import {
  memorySchema,
  parseEvidenceRecord,
  projectSchema,
  STUB_OWNER_ID,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { runStateReconciliation } from "../services/state-reconciliation.js";

const DEMO_SLUG = "atlas-demo-partner";

function main(): void {
  process.env.ATLAS_SKIP_AUDIT_LOG ??= "0";
  osStore.ensureLoaded();

  const existing = osStore.getProjectBySlug(DEMO_SLUG);
  const now = new Date().toISOString();
  const project =
    existing ??
    projectSchema.parse({
      id: crypto.randomUUID(),
      slug: DEMO_SLUG,
      name: "Atlas Demo Partner",
      description:
        "Seeded Design Partner demo — Evidence Graph + memory moat sample",
      status: "ACTIVE",
      techStack: ["typescript", "next", "fastify"],
      createdAt: now,
      updatedAt: now,
    });

  if (!existing) {
    osStore.upsertProject(project);
  }

  const evidence = [
    parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId: STUB_OWNER_ID,
      projectId: project.id,
      source: "demo-seed:ci",
      sourceType: "CI",
      sourceId: "unit-tests",
      uri: null,
      excerpt: "vitest suite green on main (demo seed)",
      version: "demo",
      observedAt: now,
      createdAt: now,
      confidence: 0.85,
      epistemicState: "OBSERVED",
      category: "TESTS",
      metadata: { feedRole: "demo_seed" },
    }),
    parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId: STUB_OWNER_ID,
      projectId: project.id,
      source: "demo-seed:semgrep",
      sourceType: "CI",
      sourceId: "javascript.lang.security.audit.xss",
      uri: "src/app.ts",
      excerpt: "semgrep:xss warning — demo finding (triage required)",
      version: null,
      observedAt: now,
      createdAt: now,
      confidence: 0.7,
      epistemicState: "OBSERVED",
      category: "SECURITY",
      metadata: { feedRole: "demo_seed", level: "warning" },
    }),
    parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId: STUB_OWNER_ID,
      projectId: project.id,
      source: "vercel:atlas-demo",
      sourceType: "PRODUCTION",
      sourceId: "https://atlas-demo.example",
      uri: "https://atlas-demo.example",
      excerpt: "production · READY",
      version: "deadbeef",
      observedAt: now,
      createdAt: now,
      confidence: 0.9,
      epistemicState: "OBSERVED",
      category: "DEPLOYMENT",
      metadata: { provider: "vercel", feedRole: "demo_seed" },
    }),
  ];

  osStore.addEvidence(project.id, evidence);

  const memory = memorySchema.parse({
    id: crypto.randomUUID(),
    type: "LESSON",
    projectId: project.id,
    statement:
      "Prefer INSUFFICIENT_EVIDENCE over inventing FACT when SARIF/deploy feeds are empty.",
    reason: ["demo-seed", "classified:LESSON:lesson language"],
    status: "ACTIVE",
    confidence: 0.8,
    category: "DECISION_MEMORY",
    epistemicState: "INFERRED",
    observationMode: "INFERRED",
    source: "demo-seed",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: null,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "system",
    scope: "PROJECT",
    priority: "HIGH",
  });
  osStore.addMemory(memory);
  appendDomainEvent({
    type: "memory.created",
    projectId: project.id,
    epistemicState: memory.epistemicState,
    payload: { memoryId: memory.id, source: "demo-seed" },
  });

  const snapshot = runStateReconciliation(project.id);
  osStore.appendAudit({
    type: "demo.seed",
    projectId: project.id,
    evidenceCount: evidence.length,
    memoryId: memory.id,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId: project.id,
        slug: project.slug,
        evidenceIds: evidence.map((e) => e.id),
        memoryId: memory.id,
        snapshotOverall: snapshot.overallEpistemicState,
        note: "Demo seed written to local osStore — open /projects or /state",
      },
      null,
      2,
    ),
  );
}

main();
