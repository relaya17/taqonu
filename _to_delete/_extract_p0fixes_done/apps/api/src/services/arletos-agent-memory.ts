import { memorySchema, type Memory } from "@atlas/shared";
import { osStore } from "../store/os-store.js";

/** Persist a lesson from the free ArletOS Agent into durable memory (local store → later Supabase). */
export function persistArletosAgentMemory(input: {
  projectId: string | null;
  userRequest: string;
  answer: string;
  runId: string;
  /**
   * Tenant boundary (P0 fix, matches memory.ts's POST /api/v1/memory):
   * server-resolved via `resolveCloudIdentity` at the call site
   * (routes/agent.ts), never client-supplied — required now that
   * `memorySchema.ownerId` is mandatory.
   */
  ownerId: string;
}): Memory {
  const now = new Date().toISOString();
  const statement = summarizeLesson(input.userRequest, input.answer);
  const memory = memorySchema.parse({
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    type: "LESSON",
    projectId: input.projectId,
    statement,
    reason: [
      "Learned from free ArletOS Agent run",
      `run:${input.runId}`,
    ],
    status: "ACTIVE",
    confidence: 0.55,
    category: "GENERATED_REASONING",
    epistemicState: "INFERRED",
    observationMode: "INFERRED",
    source: "arletos-agent",
    sourceType: "AGENT",
    sourceId: input.runId,
    evidence: [
      {
        id: crypto.randomUUID(),
        kind: "agent_run",
        reference: input.runId,
        excerpt: input.userRequest.slice(0, 400),
      },
    ],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "arletos-agent",
    scope: input.projectId ? "PROJECT" : "GLOBAL",
    priority: "MEDIUM",
  });
  osStore.addMemory(memory);
  osStore.appendAudit({
    type: "arletos.memory.learned",
    memoryId: memory.id,
    runId: input.runId,
    projectId: input.projectId,
    at: now,
  });
  return memory;
}

function summarizeLesson(request: string, answer: string): string {
  const q = request.replace(/\s+/g, " ").trim().slice(0, 180);
  const a = answer.replace(/\s+/g, " ").trim().slice(0, 320);
  return `Q: ${q} → A: ${a}`;
}
