import {
  EXTERNAL_SOURCE_CONFIDENCE,
  VERIFIED_LEGAL_MEDIA_SOURCES,
  VERIFIED_TECH_SOURCES,
  httpUrlHostname,
  isAuthorizedOfficialKnowledgeUrl,
  type SourceType,
} from "@atlas/shared";

/**
 * Canonical Knowledge Fabric source identity.
 *
 * Reuses the existing allow-lists (`VERIFIED_TECH_SOURCES`,
 * `VERIFIED_LEGAL_MEDIA_SOURCES`) as the in-process view of
 * `public.knowledge_sources`. Identity is the registry `source_id`, not the
 * raw URL string. This module does not create a second source table.
 */
export interface CanonicalKnowledgeSource {
  readonly sourceId: string;
  readonly domain: string;
  readonly organization: string;
  readonly sourceClass: string;
  readonly sourceType: SourceType | null;
  readonly allowed: boolean;
  readonly authority: number | null;
}

const SOURCE_CLASS_TO_TYPE: Readonly<Record<string, SourceType>> = {
  OFFICIAL_VENDOR_DOCS: "OFFICIAL_DOCUMENTATION",
  GOVERNMENT_OR_STANDARDS: "GOVERNMENT",
  GOVERNMENT: "GOVERNMENT",
  SECURITY_ADVISORY: "REGULATOR",
  UNIVERSITY: "ACADEMIC",
  REPOSITORY_SOURCE: "TECHNICAL_ORG",
  TECHNICAL_ARTICLE: "SECONDARY",
  FORUM_DISCUSSION: "FORUM",
  TREATY_OR_OFFICIAL_BODY: "STANDARDS_BODY",
};

/** Classified authority only — unknown classes return null (never a trusted default). */
export function classifiedSourceAuthority(sourceClass: string): number | null {
  const value = EXTERNAL_SOURCE_CONFIDENCE[sourceClass];
  return typeof value === "number" ? value : null;
}

export function sourceTypeForSourceClass(sourceClass: string): SourceType | null {
  return SOURCE_CLASS_TO_TYPE[sourceClass] ?? null;
}

function hostnameAllowed(hostname: string, candidateHost: string): boolean {
  return hostname === candidateHost || hostname.endsWith(`.${candidateHost}`);
}

function matchAllowListedSource(
  url: string,
): { readonly id: string; readonly title: string; readonly kind: string; readonly url: string } | null {
  const exactTech = VERIFIED_TECH_SOURCES.find((s) => s.url === url);
  if (exactTech) {
    return { id: exactTech.id, title: exactTech.titleEn, kind: exactTech.kind, url: exactTech.url };
  }
  const exactLegal = VERIFIED_LEGAL_MEDIA_SOURCES.find((s) => s.url === url);
  if (exactLegal) {
    return {
      id: exactLegal.id,
      title: exactLegal.titleEn,
      kind: exactLegal.kind,
      url: exactLegal.url,
    };
  }
  const hostname = httpUrlHostname(url);
  if (!hostname) return null;
  const techHost = VERIFIED_TECH_SOURCES.find((s) => {
    const host = httpUrlHostname(s.url);
    return host ? hostnameAllowed(hostname, host) : false;
  });
  if (techHost) {
    return { id: techHost.id, title: techHost.titleEn, kind: techHost.kind, url: techHost.url };
  }
  const legalHost = VERIFIED_LEGAL_MEDIA_SOURCES.find((s) => {
    const host = httpUrlHostname(s.url);
    return host ? hostnameAllowed(hostname, host) : false;
  });
  if (legalHost) {
    return {
      id: legalHost.id,
      title: legalHost.titleEn,
      kind: legalHost.kind,
      url: legalHost.url,
    };
  }
  return null;
}

/**
 * Bind a corpus/chunk row to the canonical source registry.
 * Unknown/unclassified sources are returned with `allowed: false` and
 * `authority: null` so callers fail closed.
 */
export function resolveCanonicalKnowledgeSource(input: {
  readonly url: string | null;
  readonly sourceClass: string;
  readonly title?: string;
}): CanonicalKnowledgeSource {
  const sourceClass = input.sourceClass.trim();
  const authority = classifiedSourceAuthority(sourceClass);
  const sourceType = sourceTypeForSourceClass(sourceClass);
  const url = input.url?.trim() ? input.url.trim() : null;

  if (url) {
    const matched = matchAllowListedSource(url);
    if (matched) {
      const matchedClass = matched.kind;
      const matchedAuthority =
        classifiedSourceAuthority(matchedClass) ?? authority;
      const host = httpUrlHostname(matched.url) ?? httpUrlHostname(url) ?? matched.id;
      return {
        sourceId: matched.id,
        domain: host,
        organization: matched.title,
        sourceClass: matchedClass,
        sourceType: sourceTypeForSourceClass(matchedClass) ?? sourceType,
        allowed: true,
        authority: matchedAuthority,
      };
    }
    if (isAuthorizedOfficialKnowledgeUrl(url) && authority != null) {
      const host = httpUrlHostname(url) ?? "authorized";
      return {
        sourceId: `domain:${host}`,
        domain: host,
        organization: input.title ?? host,
        sourceClass,
        sourceType,
        allowed: true,
        authority,
      };
    }
  }

  if (sourceClass === "REPOSITORY_SOURCE" && authority != null) {
    return {
      sourceId: "repository",
      domain: "repository",
      organization: input.title ?? "Repository source",
      sourceClass,
      sourceType,
      allowed: true,
      authority,
    };
  }

  const host = url ? httpUrlHostname(url) : null;
  return {
    sourceId: host ? `unclassified:${host}` : `unclassified:${sourceClass || "unknown"}`,
    domain: host ?? "unknown",
    organization: input.title ?? "Unclassified source",
    sourceClass,
    sourceType,
    allowed: false,
    authority,
  };
}
