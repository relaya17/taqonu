import type { FastifyInstance } from "fastify";
import {
  VERIFIED_LEGAL_MEDIA_SOURCES,
  VERIFIED_TECH_SOURCES,
  listOfficialRefreshTargets,
} from "@atlas/shared";

/** Canonical allow-list — do not keep a second ad-hoc source table here. */
export async function registerKnowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/knowledge", async () => ({
    policy:
      "Agents may cite only these official vendor, standards, government, and university sources. No blogs.",
    verifiedSources: "/api/v1/knowledge/verified-sources",
    download: {
      json: "/api/v1/knowledge/verified-sources/download?format=json",
      markdown: "/api/v1/knowledge/verified-sources/download?format=markdown",
    },
    counts: {
      tech: VERIFIED_TECH_SOURCES.length,
      legal: VERIFIED_LEGAL_MEDIA_SOURCES.length,
      refreshTargets: listOfficialRefreshTargets().length,
    },
    sources: [
      ...VERIFIED_TECH_SOURCES.map((s) => ({
        id: s.id,
        domain: new URL(s.url).hostname,
        organization: s.titleEn,
        sourceType: s.kind,
        url: s.url,
        allowed: true,
      })),
      ...VERIFIED_LEGAL_MEDIA_SOURCES.map((s) => ({
        id: s.id,
        domain: new URL(s.url).hostname,
        organization: s.titleEn,
        sourceType: s.kind,
        url: s.url,
        allowed: true,
      })),
    ],
  }));
}
