import { VERIFIED_LEGAL_MEDIA_SOURCES } from "./legal-media-sources.js";
import {
  isAuthorizedVerifiedTechUrl,
  VERIFIED_TECH_SOURCES,
} from "./verified-tech-sources.js";

export interface OfficialRefreshTarget {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly sourceClass: string;
  readonly family: "tech" | "legal";
  readonly priority: number;
}

function hostsFromUrls(urls: readonly string[]): readonly string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      hosts.add(new URL(url).hostname.toLowerCase());
    } catch {
      // skip
    }
  }
  return [...hosts];
}

export function verifiedLegalMediaHosts(): readonly string[] {
  return hostsFromUrls(VERIFIED_LEGAL_MEDIA_SOURCES.map((s) => s.url));
}

export function isAuthorizedLegalMediaUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return verifiedLegalMediaHosts().some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

/** Tech allow-list ∪ legal/gov allow-list. Reject everything else. */
export function isAuthorizedOfficialKnowledgeUrl(url: string): boolean {
  return isAuthorizedVerifiedTechUrl(url) || isAuthorizedLegalMediaUrl(url);
}

function techPriority(kind: string): number {
  if (kind === "GOVERNMENT_OR_STANDARDS" || kind === "SECURITY_ADVISORY") return 0;
  if (kind === "OFFICIAL_VENDOR_DOCS") return 1;
  return 2;
}

function legalSourceClass(kind: string): string {
  if (kind === "UNIVERSITY") return "UNIVERSITY";
  return "GOVERNMENT_OR_STANDARDS";
}

/** Daily refresh targets — government and advisories first, then vendor docs. */
export function listOfficialRefreshTargets(): OfficialRefreshTarget[] {
  const tech: OfficialRefreshTarget[] = VERIFIED_TECH_SOURCES.map((s) => ({
    id: `kf_tech_${s.id}`,
    title: s.titleEn,
    url: s.url,
    sourceClass: s.kind,
    family: "tech" as const,
    priority: techPriority(s.kind),
  }));
  const legal: OfficialRefreshTarget[] = VERIFIED_LEGAL_MEDIA_SOURCES.map((s) => ({
    id: `kf_legal_${s.id}`,
    title: s.titleEn,
    url: s.url,
    sourceClass: legalSourceClass(s.kind),
    family: "legal" as const,
    priority: 0,
  }));
  return [...tech, ...legal].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
}
