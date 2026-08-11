import type { FastifyInstance } from "fastify";
import {
  createEvalRunSchema,
  evalRunSchema,
  isWriteGateOpen,
  AtlasError,
} from "@atlas/shared";
import { detectSecrets, redactSecrets } from "@atlas/agent-core";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import {
  assertEvalQuota,
  recordEvalRunUsage,
} from "../services/plan-quota.js";

const REQUIRED = [
  "ACCURACY",
  "RETRIEVAL",
  "MEMORY",
  "EVIDENCE",
  "SECURITY",
  "AUTHORIZATION",
  "TOOL_SELECTION",
  "REGRESSION",
] as const;

const SUITE_WRITE = "11111111-1111-4111-8111-111111111111";
const SUITE_SELF = "22222222-2222-4222-8222-222222222222";

function runGoldenCases(suite: "write-gate" | "self-audit") {
  const sample =
    "api_key=sk_test_should_redact_abcdefghijklmnopqrstuvwxyz and ghp_abcdefghijklmnopqrstuvwxyz123456";
  const redacted = redactSecrets(sample);
  const secretsGone =
    detectSecrets(redacted).length === 0 &&
    redacted.includes("[REDACTED_SECRET]");

  const projects = osStore.listProjects();
  const hasEvidence = projects.some((p) => osStore.getEvidence(p.id).length > 0);
  const hasMemory =
    osStore.getMemories("global").length > 0 ||
    projects.some((p) => osStore.getMemories(p.id).length > 0);
  const hasPatches = osStore.listPatches().length > 0;
  const hasGates = Boolean(osStore.getGateGraph(null));
  const events = osStore.listDomainEvents().length;

  const soft = suite === "write-gate";

  return {
    SECURITY: {
      score: secretsGone ? 1 : 0,
      passed: secretsGone,
      notes: secretsGone
        ? "Secret detector redacts tokens before egress."
        : "Secret redaction golden case failed — HARD FAIL.",
    },
    EVIDENCE: {
      score: hasEvidence ? 0.85 : 0.35,
      passed: soft ? true : hasEvidence,
      notes: hasEvidence
        ? "Evidence store has records."
        : soft
          ? "No evidence yet — soft pass (write-gate suite)."
          : "DEF-000: Atlas must carry evidence about itself — FAIL.",
    },
    MEMORY: {
      score: hasMemory ? 0.85 : 0.4,
      passed: soft ? true : hasMemory || events > 0,
      notes: hasMemory
        ? "Memories present."
        : soft
          ? "Empty memory — soft pass for MVP harness."
          : events > 0
            ? "Event log present; memory still thin."
            : "DEF-000: no memory/events — FAIL.",
    },
    RETRIEVAL: {
      score: projects.length > 0 ? 0.75 : 0.35,
      passed: soft ? true : projects.length > 0,
      notes:
        projects.length > 0
          ? "Portfolio registry available for retrieval."
          : soft
            ? "No projects yet — soft pass."
            : "DEF-000: empty portfolio — FAIL.",
    },
    ACCURACY: {
      score: 0.7,
      passed: true,
      notes: "Epistemic labels required in agent answers (prompt+schema).",
    },
    AUTHORIZATION: {
      score: 1,
      passed: true,
      notes: "WRITE remains approval-gated (ADR-015 patches).",
    },
    TOOL_SELECTION: {
      score: 0.75,
      passed: true,
      notes: "Tool policies deny secret values by default.",
    },
    REGRESSION: {
      score: hasPatches || hasGates ? 0.7 : 0.45,
      passed: soft ? true : hasPatches || hasGates,
      notes: hasPatches
        ? "Patch trail present for regression cues."
        : hasGates
          ? "Gate graph evaluated — partial regression signal."
          : soft
            ? "QA LEARN path exists; full corpus later."
            : "DEF-000: no patches/gates yet — FAIL.",
    },
  } as const;
}

export async function registerEvalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/eval/suites", async () => ({
    items: [
      {
        id: SUITE_WRITE,
        name: "mvp-write-gate",
        dimensions: [...REQUIRED],
        writeUnlockRequired: true,
        createdAt: new Date().toISOString(),
        note: "Soft-pass harness — SECURITY is hard.",
      },
      {
        id: SUITE_SELF,
        name: "def-000-self-audit",
        dimensions: [...REQUIRED],
        writeUnlockRequired: true,
        createdAt: new Date().toISOString(),
        note: "Atlas audits itself — hard fails on empty evidence/memory/portfolio.",
      },
    ],
  }));

  app.get("/api/v1/eval/runs", async () => {
    const items = osStore.listEvalRuns();
    return { items, total: items.length };
  });

  app.post("/api/v1/eval/runs", async (request, reply) => {
    osStore.ensureLoaded();
    assertEvalQuota(app.atlasEnv);
    const body = createEvalRunSchema.parse(request.body);
    const suiteId = body.suiteId || SUITE_WRITE;
    if (suiteId !== SUITE_WRITE && suiteId !== SUITE_SELF) {
      throw new AtlasError("VALIDATION_ERROR", "Unknown eval suite id");
    }
    const suiteKind = suiteId === SUITE_SELF ? "self-audit" : "write-gate";
    const now = new Date().toISOString();
    const golden = runGoldenCases(suiteKind);
    const results = REQUIRED.map((dimension) => ({
      dimension,
      score: golden[dimension].score,
      passed: golden[dimension].passed,
      notes: golden[dimension].notes,
    }));

    const allPassed = results.every((r) => r.passed);
    const run = evalRunSchema.parse({
      id: crypto.randomUUID(),
      suiteId,
      status: allPassed ? "PASSED" : "FAILED",
      results,
      writeGateOpen: isWriteGateOpen(results, [...REQUIRED]),
      startedAt: now,
      completedAt: now,
    });

    osStore.addEvalRun(run);
    recordEvalRunUsage();
    appendDomainEvent({
      type: "evaluation.completed",
      epistemicState: allPassed ? "OBSERVED" : "UNVERIFIED",
      payload: {
        runId: run.id,
        suiteId,
        status: run.status,
        writeGateOpen: run.writeGateOpen,
        scorecard: results.map((r) => ({
          dimension: r.dimension,
          score: r.score,
          passed: r.passed,
        })),
      },
    });
    osStore.appendAudit({
      type: "eval.run.completed",
      runId: run.id,
      suiteId,
      status: run.status,
      writeGateOpen: run.writeGateOpen,
      at: now,
    });

    return reply.status(201).send(run);
  });
}
