import type { FastifyInstance } from "fastify";
import { tierForSourceType } from "@atlas/knowledge";

const defaultSources = [
  {
    domain: "docs.github.com",
    organization: "GitHub",
    sourceType: "OFFICIAL_DOCUMENTATION" as const,
  },
  {
    domain: "supabase.com",
    organization: "Supabase",
    sourceType: "OFFICIAL_DOCUMENTATION" as const,
  },
  {
    domain: "platform.openai.com",
    organization: "OpenAI",
    sourceType: "OFFICIAL_DOCUMENTATION" as const,
  },
];

export async function registerKnowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/knowledge", async () => ({
    sources: defaultSources.map((source) => ({
      ...source,
      authorityLevel: tierForSourceType(source.sourceType),
      allowed: true,
    })),
  }));
}
