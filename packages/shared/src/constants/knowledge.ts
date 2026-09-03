/**
 * Confidence weight for external knowledge sources, keyed by `sourceClass`
 * (see `packages/knowledge/src/fabric/search.ts`). Higher = more authoritative
 * when ranking hybrid search results. Unknown classes are ineligible —
 * they must not fall back to a trusted default.
 */
export const EXTERNAL_SOURCE_CONFIDENCE: Readonly<Record<string, number>> = {
  OFFICIAL_VENDOR_DOCS: 0.95,
  GOVERNMENT_OR_STANDARDS: 0.95,
  GOVERNMENT: 0.95,
  TREATY_OR_OFFICIAL_BODY: 0.95,
  SECURITY_ADVISORY: 0.9,
  UNIVERSITY: 0.85,
  REPOSITORY_SOURCE: 0.85,
  TECHNICAL_ARTICLE: 0.6,
  FORUM_DISCUSSION: 0.3,
};
