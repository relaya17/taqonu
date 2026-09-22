export function memoryEvidenceCount(item: {
  evidence?: readonly unknown[] | null;
}): number {
  return item.evidence?.length ?? 0;
}

export function memoryProvenanceLine(item: {
  sourceType?: string | null;
  source?: string | null;
  confidence?: number | null;
  evidence?: readonly unknown[] | null;
  verifiedBy?: string | null;
}): {
  sourceType: string;
  source: string;
  evidenceCount: number;
  confidence: number | null;
  verified: boolean;
} {
  return {
    sourceType: item.sourceType?.trim() || "UNKNOWN",
    source: item.source?.trim() || "—",
    evidenceCount: memoryEvidenceCount(item),
    confidence: typeof item.confidence === "number" ? item.confidence : null,
    verified: Boolean(item.verifiedBy),
  };
}
