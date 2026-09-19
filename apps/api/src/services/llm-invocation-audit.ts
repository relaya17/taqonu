import type { LlmUsage } from "@atlas/agent-core";
import { osStore } from "../store/os-store.js";

/**
 * Persist a real model invocation. Tokens/cost come from the provider usage
 * object — never invented. Echo/Ollama/unknown-model $0 is an honest zero.
 */
export function recordLlmInvocation(input: {
  readonly purpose: "llm.conversation" | "llm.agent";
  readonly provider: string;
  readonly usage: LlmUsage;
  readonly cacheHit: boolean;
  readonly projectId?: string | null;
  readonly userId?: string;
  readonly agentId?: string;
}): void {
  osStore.appendAudit({
    type: "llm.invocation",
    purpose: input.purpose,
    provider: input.provider,
    promptTokens: input.usage.promptTokens,
    completionTokens: input.usage.completionTokens,
    totalTokens: input.usage.totalTokens,
    costUsd: input.usage.costUsd,
    cacheHit: input.cacheHit,
    projectId: input.projectId ?? null,
    userId: input.userId ?? null,
    agentId: input.agentId ?? input.purpose,
    at: new Date().toISOString(),
  });
}
