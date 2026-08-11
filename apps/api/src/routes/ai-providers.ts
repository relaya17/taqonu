import type { FastifyInstance } from "fastify";
import { listAiProviders, AI_PROVIDER_CATALOG } from "@atlas/shared";
import { isLiveSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";

export async function registerAiProviderRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/ai/providers", async () => {
    const env = app.atlasEnv;
    const availability: Record<string, boolean> = {
      "arletos-included": true,
      "claude-haiku": Boolean(env.ANTHROPIC_API_KEY),
      "deepseek-chat": Boolean(env.DEEPSEEK_API_KEY),
      "gpt-4o-mini": Boolean(env.OPENAI_API_KEY),
      "gemini-flash": Boolean(env.GEMINI_API_KEY),
      "llama-groq": Boolean(env.GROQ_API_KEY),
      "llama-local": true,
      "claude-sonnet": Boolean(env.ANTHROPIC_API_KEY),
      "gpt-4o": Boolean(env.OPENAI_API_KEY),
      "gemini-pro": Boolean(env.GEMINI_API_KEY),
      "claude-opus": Boolean(env.ANTHROPIC_API_KEY),
      "o3-mini": Boolean(env.OPENAI_API_KEY),
      "local-checklist": true,
      "gpt-4o-vision": Boolean(env.OPENAI_API_KEY),
    };

    osStore.ensureLoaded();
    const arletosMemories =
      osStore.getMemories("global").filter((m) => m.source === "arletos-agent")
        .length +
      [...osStore.listProjects()].reduce(
        (n, p) =>
          n +
          osStore
            .getMemories(p.id)
            .filter((m) => m.source === "arletos-agent").length,
        0,
      );

    const items = listAiProviders().map((provider) => ({
      ...provider,
      available: availability[provider.id] ?? false,
      priceLabel:
        provider.billing === "included"
          ? "free"
          : `${provider.creditCost} credits · ${provider.priceTier}`,
      memoryCount:
        provider.id === "arletos-included" ? arletosMemories : undefined,
    }));

    return {
      items,
      note: "Only ArletOS Agent is free. Market models: low / mid / high credits.",
      cloudAuth: isLiveSupabase({
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      }),
      catalogVersion: 3,
      arletosMemoryCount: arletosMemories,
    };
  });

  app.get("/api/v1/ai/providers/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const provider = AI_PROVIDER_CATALOG[id as keyof typeof AI_PROVIDER_CATALOG];
    if (!provider) {
      return reply.status(404).send({ error: { message: "Provider not found" } });
    }
    return provider;
  });
}
