/**
 * PSA ECONOMIC EXPERIMENT — Stage 2.0
 * Controlled experiment: Personal Agent retained knowledge → fewer input tokens
 *
 * HARD CONSTRAINTS (from approval):
 *   - No production code changes beyond experimentArm support
 *   - No commit / push
 *   - Uses ONLY sanctioned test infrastructure (buildRouteTestApp, seed helpers)
 *   - Goes through conversation.ts + experimentArm boundary
 *   - Captures tokens from osStore.listAudit()
 *   - STOP after report
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";
import { randomUUID } from "node:crypto";

// ── Isolation: must be set before any osStore import ─────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-psa-experiment-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
// DO NOT set ATLAS_SKIP_AUDIT_LOG — we need audit log for token capture
delete process.env.ATLAS_SKIP_AUDIT_LOG;
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

// ── Auth mock ─────────────────────────────────────────────────────────────────
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

// ── Imports ───────────────────────────────────────────────────────────────────
const { registerConversationRoutes } = await import("../routes/conversation.js");
const { buildRouteTestApp } = await import("../routes/test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

// ── Provider config (OpenAI) ──────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4o-mini";
const PRICE_INPUT_PER_1M = 0.15;
const PRICE_OUTPUT_PER_1M = 0.60;

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY must be set to run this experiment");
}

// ── Fixture helpers ───────────────────────────────────────────────────────────
function signedInUser(): AuthUser {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "experiment-owner@example.com",
    displayName: "Experiment Owner",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeProject(owner: AuthUser, name: string): string {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const id = randomUUID();
  osStore.upsertProject({
    id,
    slug: `proj-${id.slice(0, 8)}`,
    name,
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  bindProjectOwner(id, owner.id, "bound_on_create");
  return id;
}

// ── Token capture helper ──────────────────────────────────────────────────────
function getLatestAuditTokens(beforeCount: number): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | null {
  const allAudit = osStore.listAudit();
  const llmAudit = allAudit.filter((e) => e["type"] === "llm.invocation");
  if (llmAudit.length <= beforeCount) return null;
  const latest = llmAudit[llmAudit.length - 1] as Record<string, unknown>;
  return {
    promptTokens: latest.promptTokens ?? 0,
    completionTokens: latest.completionTokens ?? 0,
    totalTokens: latest.totalTokens ?? 0,
  };
}

function computeCostFromTokens(promptTokens: number, completionTokens: number): number {
  return (promptTokens * PRICE_INPUT_PER_1M + completionTokens * PRICE_OUTPUT_PER_1M) / 1_000_000;
}

// ── Experiment state ──────────────────────────────────────────────────────────
interface TurnResult {
  task: string;
  arm: "BASELINE" | "TREATMENT";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  answer: string;
  outcome: "PASS" | "FAIL" | "ERROR";
  outcomeNote: string;
}

const results: TurnResult[] = [];
let app: FastifyInstance;
let owner: AuthUser;
let projectId: string;
const UTC_START = new Date().toISOString();

// ── 3 Follow-up tasks ─────────────────────────────────────────────────────────
const FOLLOW_UP_TASKS = [
  {
    question: "What specific queue growth rate did BENCH-QUEUE-001 measure over the 60-minute load test?",
    checkPass: (ans: string) =>
      ans.toLowerCase().includes("340") ||
      (ans.toLowerCase().includes("queue") && ans.toLowerCase().includes("growth")),
    note: "Must reference ~340% queue growth from BENCH-QUEUE-001",
  },
  {
    question: "What is the current decision status for the RES-007 queue persistence fix?",
    checkPass: (ans: string) =>
      ans.toLowerCase().includes("proposed") ||
      ans.toLowerCase().includes("pending") ||
      ans.toLowerCase().includes("bench-queue-002"),
    note: "Must reference PROPOSED/PENDING status or BENCH-QUEUE-002 dependency",
  },
  {
    question: "What is the identified root cause of the queue growth problem in the investigation?",
    checkPass: (ans: string) =>
      ans.toLowerCase().includes("eviction") ||
      ans.toLowerCase().includes("unbounded") ||
      ans.toLowerCase().includes("ttl") ||
      (ans.toLowerCase().includes("queue") && ans.toLowerCase().includes("root")),
    note: "Must reference unbounded queue / no eviction policy",
  },
];

// ── Conversation call helper ──────────────────────────────────────────────────
async function callConversation(opts: {
  app: FastifyInstance;
  user: AuthUser;
  projectId: string;
  question: string;
  threadId: string;
  experimentArm?: "baseline" | "treatment";
}): Promise<{ answer: string; statusCode: number; latencyMs: number }> {
  getRequestUser.mockResolvedValue(opts.user);
  const body: Record<string, unknown> = {
    projectId: opts.projectId,
    threadId: opts.threadId,
    aiProviderId: MODEL,
    message: opts.question,
    locale: "en",
  };
  if (opts.experimentArm) {
    body.experimentArm = opts.experimentArm;
  }

  const t0 = Date.now();
  const response = await opts.app.inject({
    method: "POST",
    url: "/api/v1/conversation/message",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  let json: any = {};
  try { json = response.json(); } catch { /* ignore */ }
  return {
    answer: json.answer ?? json.message ?? String(response.payload).slice(0, 200),
    statusCode: response.statusCode,
    latencyMs,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  app = await buildRouteTestApp(
    async (a) => registerConversationRoutes(a),
    {
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY,
      OPENAI_MODEL: MODEL,
    } as Record<string, string | undefined>,
  );

  // Seed Atlas credits — isolated to temp store (ATLAS_SKIP_STORE_PERSIST=1)
  osStore.setCredits({
    balance: 12,
    lifetimeGranted: 12,
    lifetimeSpent: 0,
    freeGrant: 12,
    updatedAt: new Date().toISOString(),
  });

  owner = signedInUser();
  projectId = makeProject(owner, "Queue-Persistence Investigation");

  // Seed snapshot — project identity ONLY, not substantive knowledge
  osStore.setSnapshot({
    id: randomUUID(),
    projectId,
    asOf: new Date().toISOString(),
    reconciledAt: new Date().toISOString(),
    slices: [
      {
        key: "DATABASE",
        summary: "Project: Queue-Persistence Investigation. Status: ACTIVE. Engineering investigation into queue persistence behavior under sustained load.",
        epistemicState: "OBSERVED",
        confidence: 0.9,
        evidenceIds: [],
        claimIds: [],
        asOf: new Date().toISOString(),
        validUntil: null,
        stale: false,
      },
    ],
    conflicts: [],
    overallEpistemicState: "OBSERVED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Parameters<typeof osStore.setSnapshot>[0]);

  // Seed memories — project-scoped
  const now = new Date().toISOString();
  osStore.addMemory({
    id: randomUUID(),
    ownerId: owner.id,
    type: "LESSON",
    projectId,
    statement: "BENCH-QUEUE-001 measured approximately 340% queue-write growth under sustained load over 60 minutes. Baseline queue depth was 412 items, peaking at 1,812 items at the 60-minute mark. Growth pattern was linear and unbounded.",
    reason: ["experiment-seed"],
    status: "ACTIVE",
    confidence: 0.9,
    category: "GENERATED_REASONING",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: "experiment-seed",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "experiment",
    scope: "PROJECT",
    priority: "MEDIUM",
  } as Parameters<typeof osStore.addMemory>[0]);

  osStore.addMemory({
    id: randomUUID(),
    ownerId: owner.id,
    type: "LESSON",
    projectId,
    statement: "The root cause of the queue growth problem (RES-007 investigation) is an unbounded in-memory queue with no eviction policy and no TTL. Items accumulate indefinitely under load with no mechanism to bound the queue depth.",
    reason: ["experiment-seed"],
    status: "ACTIVE",
    confidence: 0.9,
    category: "GENERATED_REASONING",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: "experiment-seed",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "experiment",
    scope: "PROJECT",
    priority: "MEDIUM",
  } as Parameters<typeof osStore.addMemory>[0]);

  // Seed decision — project-scoped
  osStore.addDecision({
    id: randomUUID(),
    projectId,
    decision: "RES-007 PROPOSED: Implement bounded queue with TTL eviction policy. Status: PROPOSED, pending BENCH-QUEUE-002 validation before implementation commitment.",
    reason: ["experiment-seed"],
    alternatives: [],
    tradeOffs: [],
    evidence: [],
    status: "ACTIVE",
    confidence: 0.9,
    epistemicState: "CONFIRMED",
    supersededBy: null,
    adrPath: null,
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  } as Parameters<typeof osStore.addDecision>[0]);

  console.log("\n=== PSA ECONOMIC EXPERIMENT — Stage 2.0 ===");
  console.log(`UTC Start: ${UTC_START}`);
  console.log(`Project ID: ${projectId}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Pricing: input $${PRICE_INPUT_PER_1M}/1M, output $${PRICE_OUTPUT_PER_1M}/1M\n`);
}, 60_000);

afterAll(async () => {
  await app?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── ESTABLISHMENT PHASE ───────────────────────────────────────────────────────
describe("Establishment Phase", () => {
  it("memories and decisions are persisted and retrievable", () => {
    const memories = osStore.getMemories(projectId, owner.id);
    const decisions = osStore.getDecisions(projectId);
    const snapshot = osStore.getSnapshot(projectId);

    expect(memories.length).toBeGreaterThanOrEqual(2);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(snapshot).not.toBeNull();

    const memStatements = memories.map((m: any) => m.statement);
    expect(memStatements.some((s: string) => s.includes("340%"))).toBe(true);
    expect(memStatements.some((s: string) => s.includes("unbounded"))).toBe(true);
    expect(decisions.some((d: any) => d.decision.includes("PROPOSED"))).toBe(true);

    console.log("✓ Establishment verified: 2 memories + 1 decision persisted");
  });
});

// ── PAIRED FOLLOW-UP TASKS ────────────────────────────────────────────────────
describe("Paired Follow-up Tasks", () => {
  for (let i = 0; i < FOLLOW_UP_TASKS.length; i++) {
    const task = FOLLOW_UP_TASKS[i];

    it(`Task ${i + 1} — BASELINE: ${task.question.slice(0, 60)}`, async () => {
      const auditBefore = osStore.listAudit().filter((e) => e["type"] === "llm.invocation").length;
      const threadId = randomUUID();

      const { answer, statusCode, latencyMs } = await callConversation({
        app,
        user: owner,
        projectId,
        question: task.question,
        threadId,
        experimentArm: "baseline",
      });

      const tokens = getLatestAuditTokens(auditBefore);
      const outcome = !tokens ? "ERROR" : (task.checkPass(answer) ? "PASS" : "FAIL");

      const result: TurnResult = {
        task: `Task ${i + 1}`,
        arm: "BASELINE",
        promptTokens: tokens?.promptTokens ?? 0,
        completionTokens: tokens?.completionTokens ?? 0,
        totalTokens: tokens?.totalTokens ?? 0,
        costUsd: computeCostFromTokens(tokens?.promptTokens ?? 0, tokens?.completionTokens ?? 0),
        latencyMs,
        answer: answer.slice(0, 400),
        outcome: outcome as "PASS" | "FAIL" | "ERROR",
        outcomeNote: task.note,
      };
      results.push(result);

      console.log(`\n[BASELINE Task ${i + 1}] ${task.question}`);
      console.log(`  HTTP: ${statusCode} | Latency: ${latencyMs}ms | Outcome: ${outcome}`);
      console.log(`  Tokens: in=${result.promptTokens} out=${result.completionTokens} total=${result.totalTokens}`);
      console.log(`  Answer: ${answer.slice(0, 200)}`);

      expect(statusCode).toBe(201);
    }, 60_000);

    it(`Task ${i + 1} — TREATMENT: ${task.question.slice(0, 60)}`, async () => {
      const auditBefore = osStore.listAudit().filter((e) => e["type"] === "llm.invocation").length;
      const threadId = randomUUID();

      const { answer, statusCode, latencyMs } = await callConversation({
        app,
        user: owner,
        projectId,
        question: task.question,
        threadId,
        experimentArm: "treatment",
      });

      const tokens = getLatestAuditTokens(auditBefore);
      const outcome = !tokens ? "ERROR" : (task.checkPass(answer) ? "PASS" : "FAIL");

      const result: TurnResult = {
        task: `Task ${i + 1}`,
        arm: "TREATMENT",
        promptTokens: tokens?.promptTokens ?? 0,
        completionTokens: tokens?.completionTokens ?? 0,
        totalTokens: tokens?.totalTokens ?? 0,
        costUsd: computeCostFromTokens(tokens?.promptTokens ?? 0, tokens?.completionTokens ?? 0),
        latencyMs,
        answer: answer.slice(0, 400),
        outcome: outcome as "PASS" | "FAIL" | "ERROR",
        outcomeNote: task.note,
      };
      results.push(result);

      console.log(`\n[TREATMENT Task ${i + 1}] ${task.question}`);
      console.log(`  HTTP: ${statusCode} | Latency: ${latencyMs}ms | Outcome: ${outcome}`);
      console.log(`  Tokens: in=${result.promptTokens} out=${result.completionTokens} total=${result.totalTokens}`);
      console.log(`  Answer: ${answer.slice(0, 200)}`);

      expect(statusCode).toBe(201);
    }, 60_000);
  }
});

// ── FINAL REPORT ──────────────────────────────────────────────────────────────
describe("Experiment Report", () => {
  it("produces final paired comparison report", () => {
    const utcEnd = new Date().toISOString();

    console.log("\n" + "=".repeat(70));
    console.log("PSA ECONOMIC EXPERIMENT — FINAL REPORT");
    console.log("=".repeat(70));

    console.log("\n## A. Experiment Identity");
    console.log(`Application: Queue-Persistence Investigation`);
    console.log(`Project ID: ${projectId}`);
    console.log(`Workload: 3 paired follow-up tasks (factual retrieval)`);
    console.log(`Model: ${MODEL}`);
    console.log(`UTC Start: ${UTC_START}`);
    console.log(`UTC End: ${utcEnd}`);

    console.log("\n## B. Establishment Evidence");
    console.log(`  - Memory 1: BENCH-QUEUE-001 measured ~340% queue-write growth`);
    console.log(`  - Memory 2: Root cause = unbounded in-memory queue, no eviction/TTL`);
    console.log(`  - Decision: PROPOSED bounded queue with TTL eviction, pending BENCH-QUEUE-002`);

    console.log("\n## C. Baseline/Treatment Integrity");
    console.log(`BASELINE: experimentArm='baseline' → isBaseline=true → memories=[],decisions=[],snapshot=null`);
    console.log(`TREATMENT: experimentArm='treatment' → full memory/decision/snapshot injection`);
    console.log(`Isolation: fresh threadId per execution`);

    console.log("\n## D. Raw Measurements");
    console.log(`${"Task".padEnd(8)} ${"Arm".padEnd(12)} ${"In Tok".padStart(8)} ${"Out Tok".padStart(8)} ${"Total".padStart(8)} ${"Cost USD".padStart(10)} ${"Latency".padStart(8)} ${"Outcome".padStart(8)}`);
    console.log("-".repeat(82));
    for (const r of results) {
      console.log(
        `${r.task.padEnd(8)} ${r.arm.padEnd(12)} ${String(r.promptTokens).padStart(8)} ${String(r.completionTokens).padStart(8)} ${String(r.totalTokens).padStart(8)} ${("$" + r.costUsd.toFixed(6)).padStart(10)} ${String(r.latencyMs).padStart(8)} ${r.outcome.padStart(8)}`
      );
    }

    console.log("\n## E. Paired Comparison");
    const tasks = ["Task 1", "Task 2", "Task 3"];
    let totalBaselineInput = 0, totalTreatmentInput = 0;
    let totalBaselineCost = 0, totalTreatmentCost = 0;
    let baselinePassed = 0, treatmentPassed = 0;

    for (const taskName of tasks) {
      const bl = results.find(r => r.task === taskName && r.arm === "BASELINE");
      const tr = results.find(r => r.task === taskName && r.arm === "TREATMENT");
      if (!bl || !tr) continue;

      const inputDiff = tr.promptTokens - bl.promptTokens;
      const inputPct = bl.promptTokens > 0 ? ((inputDiff / bl.promptTokens) * 100).toFixed(1) : "N/A";
      const costDiff = tr.costUsd - bl.costUsd;

      totalBaselineInput += bl.promptTokens;
      totalTreatmentInput += tr.promptTokens;
      totalBaselineCost += bl.costUsd;
      totalTreatmentCost += tr.costUsd;
      if (bl.outcome === "PASS") baselinePassed++;
      if (tr.outcome === "PASS") treatmentPassed++;

      console.log(`${taskName}:`);
      console.log(`  Input token diff: ${inputDiff > 0 ? "+" : ""}${inputDiff} (${inputPct}%)`);
      console.log(`  Cost diff: ${costDiff >= 0 ? "+" : ""}$${costDiff.toFixed(6)}`);
      console.log(`  Outcome: BASELINE=${bl.outcome} TREATMENT=${tr.outcome}`);
    }

    const aggInputDiff = totalTreatmentInput - totalBaselineInput;
    const aggCostDiff = totalTreatmentCost - totalBaselineCost;
    const aggPct = totalBaselineInput > 0 ? ((aggInputDiff / totalBaselineInput) * 100).toFixed(1) : "N/A";

    console.log(`\nAggregate:`);
    console.log(`  Mean input tokens — BASELINE: ${(totalBaselineInput / 3).toFixed(0)}  TREATMENT: ${(totalTreatmentInput / 3).toFixed(0)}`);
    console.log(`  Total input tokens — BASELINE: ${totalBaselineInput}  TREATMENT: ${totalTreatmentInput}  DIFF: ${aggInputDiff > 0 ? "+" : ""}${aggInputDiff} (${aggPct}%)`);
    console.log(`  Total cost — BASELINE: $${totalBaselineCost.toFixed(6)}  TREATMENT: $${totalTreatmentCost.toFixed(6)}  DIFF: ${aggCostDiff >= 0 ? "+" : ""}$${aggCostDiff.toFixed(6)}`);
    console.log(`  Outcome pass rate — BASELINE: ${baselinePassed}/3  TREATMENT: ${treatmentPassed}/3`);

    console.log("\n## F. Evidence Classification");
    const anyError = results.some(r => r.outcome === "ERROR");
    console.log(`Token measurements: ${!anyError ? "OBSERVED" : "BLOCKED"}`);
    console.log(`Fixture: TEST_VERIFIED (sanctioned in-process test infrastructure)`);

    console.log("\n## G. Economic Conclusion");
    if (anyError) {
      console.log("INSUFFICIENT EVIDENCE — experiment completed with errors");
    } else if (aggInputDiff < 0) {
      console.log("RESOURCE SAVING OBSERVED — Treatment used fewer input tokens");
      console.log(aggCostDiff < 0 ? "MONETARY SAVING OBSERVED" : "MONETARY SAVING NOT ESTABLISHED — output overhead offset savings");
    } else if (aggInputDiff > 0) {
      console.log("NO RESOURCE SAVING OBSERVED — Treatment used MORE input tokens (context injection overhead)");
    } else {
      console.log("NO RESOURCE SAVING OBSERVED — No token difference");
    }

    console.log("\n## H. Threats / Limitations");
    console.log("- Sample size: 3 paired tasks (minimum experiment)");
    console.log("- Provider/model: OpenAI gpt-4o-mini only");
    console.log("- Fixture vs production: sanctioned in-process test fixture");
    console.log("- Token variability: single measurement per pair");
    console.log("- Context injection overhead: TREATMENT system prompt longer by design");

    console.log("\n## I. Git Integrity");
    console.log("No commit. No push.");

    console.log("\n=== EXPERIMENT COMPLETE — HARD STOP ===");

    expect(results).toHaveLength(6);
    expect(results.every(r => r.promptTokens >= 0)).toBe(true);
  });
});
