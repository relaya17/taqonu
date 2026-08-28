/**
 * Atlas Expert-Battle Knowledge Authority System (ADR-014 v2).
 *
 * Two independent hierarchies:
 * 1. SOURCE_AUTHORITY_RANKS — runtime observation authority (production > staging > test)
 * 2. KNOWLEDGE_SOURCE_TYPES — knowledge origin authority (official docs > standards > books)
 *
 * Agents must cite both the knowledge source and the observation authority.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   1. RUNTIME OBSERVATION AUTHORITY (existing, for live evidence)
   ───────────────────────────────────────────────────────────────────────────── */

export const SOURCE_AUTHORITY_RANKS = [
  "LIVE_PRODUCTION",
  "AUTOMATED_VERIFIED_TEST",
  "STAGING_OBSERVATION",
  "CI_ARTIFACT",
  "REPOSITORY_CODE",
  "ARCHITECTURE_DOCUMENT",
  "DEVELOPER_STATEMENT",
  "LLM_INFERENCE",
] as const;

export type SourceAuthorityRank = (typeof SOURCE_AUTHORITY_RANKS)[number];

/** Lower number = higher authority. */
export const SOURCE_AUTHORITY_WEIGHT: Readonly<
  Record<SourceAuthorityRank, number>
> = {
  LIVE_PRODUCTION: 1,
  AUTOMATED_VERIFIED_TEST: 2,
  STAGING_OBSERVATION: 3,
  CI_ARTIFACT: 4,
  REPOSITORY_CODE: 5,
  ARCHITECTURE_DOCUMENT: 6,
  DEVELOPER_STATEMENT: 7,
  LLM_INFERENCE: 8,
};

export function compareSourceAuthority(
  a: SourceAuthorityRank,
  b: SourceAuthorityRank,
): number {
  return SOURCE_AUTHORITY_WEIGHT[a] - SOURCE_AUTHORITY_WEIGHT[b];
}

/* ─────────────────────────────────────────────────────────────────────────────
   2. KNOWLEDGE SOURCE TYPE HIERARCHY (new — for Expert Battle)
   ───────────────────────────────────────────────────────────────────────────── */

export const KNOWLEDGE_SOURCE_TYPES = [
  "OFFICIAL_DOCUMENTATION",
  "STANDARDS",
  "CVE_ADVISORY",
  "PROFESSIONAL_BOOKS",
  "ACADEMIC_PAPERS",
  "SOURCE_CODE",
  "ISSUE_TRACKER",
  "COMMUNITY_QA",
  "BLOG_TUTORIAL",
  "LLM_GENERATED",
] as const;

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export interface KnowledgeSourceDefinition {
  readonly type: KnowledgeSourceType;
  readonly rank: number;
  readonly authority: number;
  readonly description: string;
  readonly examples: readonly string[];
  readonly trustNotes: string;
}

export const KNOWLEDGE_SOURCE_CATALOG: Readonly<
  Record<KnowledgeSourceType, KnowledgeSourceDefinition>
> = {
  OFFICIAL_DOCUMENTATION: {
    type: "OFFICIAL_DOCUMENTATION",
    rank: 1,
    authority: 0.99,
    description: "Official API, framework, language, platform documentation",
    examples: [
      "docs.python.org",
      "nodejs.org/docs",
      "developer.mozilla.org",
      "cloud.google.com/docs",
      "docs.aws.amazon.com",
      "learn.microsoft.com",
    ],
    trustNotes: "Primary source of truth for APIs and behavior",
  },
  STANDARDS: {
    type: "STANDARDS",
    rank: 2,
    authority: 0.98,
    description: "Industry standards and specifications",
    examples: [
      "ISO standards",
      "NIST frameworks",
      "OWASP guides",
      "WCAG specifications",
      "RFCs",
      "W3C specifications",
    ],
    trustNotes: "Authoritative for compliance and best practices",
  },
  CVE_ADVISORY: {
    type: "CVE_ADVISORY",
    rank: 3,
    authority: 0.95,
    description: "Security vulnerability databases and advisories",
    examples: [
      "NVD (nvd.nist.gov)",
      "CVE (cve.org)",
      "CISA advisories",
      "GitHub Security Advisories",
      "Vendor security bulletins",
    ],
    trustNotes: "Critical for security decisions, time-sensitive",
  },
  PROFESSIONAL_BOOKS: {
    type: "PROFESSIONAL_BOOKS",
    rank: 4,
    authority: 0.90,
    description: "Published technical books from recognized experts",
    examples: [
      "Clean Architecture (Martin)",
      "DDIA (Kleppmann)",
      "DDD (Evans)",
      "POEAA (Fowler)",
      "Release It! (Nygard)",
    ],
    trustNotes: "Stable principles, may lag latest APIs",
  },
  ACADEMIC_PAPERS: {
    type: "ACADEMIC_PAPERS",
    rank: 5,
    authority: 0.85,
    description: "Peer-reviewed academic and research publications",
    examples: [
      "ACM Digital Library",
      "IEEE Xplore",
      "arXiv (cs section)",
      "Google Scholar verified",
    ],
    trustNotes: "Research-grade, may need implementation translation",
  },
  SOURCE_CODE: {
    type: "SOURCE_CODE",
    rank: 6,
    authority: 0.80,
    description: "Actual implementation code and repositories",
    examples: [
      "GitHub verified repos",
      "Official SDK source",
      "Reference implementations",
    ],
    trustNotes: "Ground truth for behavior, but may contain bugs",
  },
  ISSUE_TRACKER: {
    type: "ISSUE_TRACKER",
    rank: 7,
    authority: 0.70,
    description: "Bug reports and issue discussions",
    examples: [
      "GitHub Issues",
      "Jira (public)",
      "GitLab Issues",
      "Bug trackers",
    ],
    trustNotes: "Real problems, but solutions may be speculative",
  },
  COMMUNITY_QA: {
    type: "COMMUNITY_QA",
    rank: 8,
    authority: 0.50,
    description: "Community Q&A platforms",
    examples: [
      "Stack Overflow",
      "Reddit (r/programming, etc.)",
      "Discord communities",
      "Dev.to discussions",
    ],
    trustNotes: "Community experience, quality varies widely",
  },
  BLOG_TUTORIAL: {
    type: "BLOG_TUTORIAL",
    rank: 9,
    authority: 0.40,
    description: "Blog posts and tutorials",
    examples: [
      "Medium technical posts",
      "Personal developer blogs",
      "Tutorial sites",
    ],
    trustNotes: "Supplementary, verify against official sources",
  },
  LLM_GENERATED: {
    type: "LLM_GENERATED",
    rank: 10,
    authority: 0.20,
    description: "AI-generated content without verification",
    examples: [
      "ChatGPT output",
      "Copilot suggestions",
      "Claude responses",
    ],
    trustNotes: "HYPOTHESIS ONLY — must verify before trusting",
  },
};

export function getKnowledgeAuthority(type: KnowledgeSourceType): number {
  return KNOWLEDGE_SOURCE_CATALOG[type].authority;
}

export function compareKnowledgeAuthority(
  a: KnowledgeSourceType,
  b: KnowledgeSourceType,
): number {
  return (
    KNOWLEDGE_SOURCE_CATALOG[a].rank - KNOWLEDGE_SOURCE_CATALOG[b].rank
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   3. KNOWLEDGE SOURCE SCORES (6-score system)
   ───────────────────────────────────────────────────────────────────────────── */

export interface KnowledgeSourceScores {
  /** Source trustworthiness (0-1) */
  readonly authority: number;
  /** How current the information is (0-1) */
  readonly freshness: number;
  /** Match to the specific query (0-1) */
  readonly relevance: number;
  /** Quality of supporting evidence (0-1) */
  readonly evidenceQuality: number;
  /** Independent corroboration available (0-1) */
  readonly independence: number;
  /** Verification status */
  readonly verificationStatus: "VERIFIED" | "PARTIAL" | "UNVERIFIED";
}

export function computeCompositeScore(scores: KnowledgeSourceScores): number {
  const weights = {
    authority: 0.25,
    freshness: 0.15,
    relevance: 0.20,
    evidenceQuality: 0.20,
    independence: 0.10,
    verification: 0.10,
  };
  const verificationMultiplier =
    scores.verificationStatus === "VERIFIED"
      ? 1.0
      : scores.verificationStatus === "PARTIAL"
        ? 0.7
        : 0.4;

  return (
    scores.authority * weights.authority +
    scores.freshness * weights.freshness +
    scores.relevance * weights.relevance +
    scores.evidenceQuality * weights.evidenceQuality +
    scores.independence * weights.independence +
    verificationMultiplier * weights.verification
  );
}
