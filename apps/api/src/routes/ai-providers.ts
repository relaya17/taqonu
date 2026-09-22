import type { FastifyInstance } from "fastify";
import { listAiProviders, AI_PROVIDER_CATALOG } from "@atlas/shared";
import { isLiveSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { countOwnedMemoriesBySource } from "../services/memory-scope.js";

export async function registerAiProviderRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/ai/providers", async (request, reply) => {
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

    // Tenant boundary (Defect #2 fix, Pass 5): this count must reflect only
    // the caller's own memories, never a cross-tenant sum. `resolveCloudIdentity`
    // is the same soft-identity resolution `GET /api/v1/billing/credits`
    // already uses on this same `/models` page -- the real tenant ownerId
    // when signed in, the well-known stub/system owner id when not (never
    // another real tenant's id) -- so this catalog route stays reachable
    // without a session, exactly as before, while the memory-derived number
    // it reports can no longer include any other tenant's data. The unsafe
    // unscoped `osStore.getMemories(p.id)` read (no ownerId argument, across
    // every project of every tenant) is gone, not merely unserialized --
    // see `countOwnedMemoriesBySource` (`services/memory-scope.ts`), whose
    // `ownerId` parameter is mandatory by construction.
    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
    const arletosMemories = countOwnedMemoriesBySource({
      ownerId: identity.ownerId,
      source: "arletos-agent",
    });

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
