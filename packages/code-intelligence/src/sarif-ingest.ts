/**
 * Ingest SARIF (Semgrep / CodeQL / generic) → Atlas SECURITY evidence.
 * Does not invent findings — empty SARIF → no evidence + INSUFFICIENT note.
 */

export interface SarifResultLite {
  readonly ruleId?: string;
  readonly level?: string;
  readonly message?: { readonly text?: string };
  readonly locations?: ReadonlyArray<{
    readonly physicalLocation?: {
      readonly artifactLocation?: { readonly uri?: string };
      readonly region?: { readonly startLine?: number };
    };
  }>;
}

export interface SarifRunLite {
  readonly tool?: { readonly driver?: { readonly name?: string } };
  readonly results?: readonly SarifResultLite[];
}

export interface SarifDocumentLite {
  readonly version?: string;
  readonly runs?: readonly SarifRunLite[];
}

export interface SecurityFindingDraft {
  readonly ruleId: string;
  readonly level: "error" | "warning" | "note" | "none";
  readonly message: string;
  readonly file: string | null;
  readonly startLine: number | null;
  readonly tool: string;
  readonly excerpt: string;
}

function normalizeLevel(level: string | undefined): SecurityFindingDraft["level"] {
  const l = (level ?? "warning").toLowerCase();
  if (l === "error" || l === "warning" || l === "note" || l === "none") return l;
  if (l === "fail") return "error";
  return "warning";
}

/** Parse SARIF JSON into normalized security finding drafts. */
export function parseSarifToFindings(doc: SarifDocumentLite): SecurityFindingDraft[] {
  const out: SecurityFindingDraft[] = [];
  for (const run of doc.runs ?? []) {
    const tool = run.tool?.driver?.name?.trim() || "sarif";
    for (const result of run.results ?? []) {
      const loc = result.locations?.[0]?.physicalLocation;
      const file = loc?.artifactLocation?.uri ?? null;
      const startLine = loc?.region?.startLine ?? null;
      const ruleId = result.ruleId?.trim() || "unknown-rule";
      const message = result.message?.text?.trim() || ruleId;
      const level = normalizeLevel(result.level);
      out.push({
        ruleId,
        level,
        message,
        file,
        startLine,
        tool,
        excerpt: `${tool}:${ruleId} ${level} — ${message}${file ? ` @ ${file}${startLine ? `:${startLine}` : ""}` : ""}`.slice(
          0,
          500,
        ),
      });
    }
  }
  return out;
}

export function severityFromSarifLevel(
  level: SecurityFindingDraft["level"],
): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  switch (level) {
    case "error":
      return "HIGH";
    case "warning":
      return "MEDIUM";
    case "note":
      return "LOW";
    default:
      return "LOW";
  }
}
