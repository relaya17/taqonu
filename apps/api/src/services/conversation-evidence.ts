import type {
  ConversationEvidenceRef,
  EpistemicState,
  EvidenceRecord,
  KnowledgeSearchResult,
  Memory,
} from "@atlas/shared";

export type EvidencePoolInput = {
  memories: readonly Pick<
    Memory,
    "id" | "statement" | "epistemicState" | "evidence"
  >[];
  evidenceRecords: readonly Pick<
    EvidenceRecord,
    "id" | "source" | "excerpt" | "epistemicState" | "sourceType"
  >[];
  knowledge: Pick<KnowledgeSearchResult, "hits" | "plainLanguage"> | null;
  decisions?: readonly { id: string; title?: string; statement?: string }[];
  hasSnapshot?: boolean;
  snapshotLabel?: string | null;
  projectCount?: number;
};

const REFUSAL: Record<"en" | "he" | "ar", string> = {
  en: "INSUFFICIENT_EVIDENCE — no evidence packages retrieved for this question. I will not invent portfolio, deploy, or DB facts. Add projects, memories, knowledge, or run an audit, then ask again.",
  he: "INSUFFICIENT_EVIDENCE — לא נשלפו חבילות ראיות לשאלה זו. לא אמציא עובדות על תיק, פריסה או מסד נתונים. הוסיפו פרויקטים, זיכרון, ידע או הריצו ביקורת, ואז שאלו שוב.",
  ar: "INSUFFICIENT_EVIDENCE — لم تُسترجع حزم أدلة لهذا السؤال. لن أخترع حقائق عن المحفظة أو النشر أو قاعدة البيانات. أضف مشاريع أو ذاكرة أو معرفة أو شغّل تدقيقاً ثم اسأل مجدداً.",
};

/** Collect cited evidence package refs — never invent ids. */
export function collectEvidenceRefs(
  input: EvidencePoolInput,
): ConversationEvidenceRef[] {
  const refs: ConversationEvidenceRef[] = [];
  const seen = new Set<string>();

  const push = (ref: ConversationEvidenceRef) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const memory of input.memories) {
    if (memory.evidence.length === 0) {
      push({
        id: memory.id,
        kind: "memory",
        reference: `memory:${memory.id}`,
        excerpt: memory.statement.slice(0, 240),
        epistemicState: memory.epistemicState,
      });
    } else {
      for (const ev of memory.evidence) {
        push({
          id: ev.id,
          kind: "memory",
          reference: ev.reference,
          ...(ev.excerpt ? { excerpt: ev.excerpt.slice(0, 240) } : {}),
          epistemicState: memory.epistemicState,
        });
      }
    }
  }

  for (const record of input.evidenceRecords) {
    push({
      id: record.id,
      kind: "evidence",
      reference: record.source,
      ...(record.excerpt ? { excerpt: record.excerpt.slice(0, 240) } : {}),
      epistemicState: record.epistemicState,
    });
  }

  for (const hit of input.knowledge?.hits ?? []) {
    push({
      id: hit.id,
      kind: "knowledge",
      reference: hit.sourceId
        ? `source:${hit.sourceId}${hit.sourceVersion ? `@${hit.sourceVersion}` : ""}`
        : hit.url ?? hit.title,
      excerpt: hit.excerpt.slice(0, 240),
      epistemicState: hit.epistemicState,
    });
  }

  for (const decision of input.decisions ?? []) {
    push({
      id: decision.id,
      kind: "decision",
      reference: decision.title ?? decision.statement ?? `decision:${decision.id}`,
      ...(decision.statement
        ? { excerpt: decision.statement.slice(0, 240) }
        : {}),
      epistemicState: "OBSERVED",
    });
  }

  if (input.hasSnapshot) {
    push({
      id: "project-snapshot",
      kind: "snapshot",
      reference: input.snapshotLabel ?? "project-state-snapshot",
      epistemicState: "OBSERVED",
    });
  }

  if ((input.projectCount ?? 0) > 0) {
    push({
      id: "portfolio-registry",
      kind: "snapshot",
      reference: `portfolio-projects:${input.projectCount}`,
      excerpt: `${input.projectCount} registered project(s) in osStore`,
      epistemicState: "OBSERVED",
    });
  }

  return refs;
}

/**
 * Hard rule: empty evidence pool → INSUFFICIENT_EVIDENCE (refuse hallucination).
 * With packages → PROPOSED (LLM answers stay labeled, never silent FACT).
 */
export function resolveConversationEpistemic(
  refs: readonly ConversationEvidenceRef[],
): EpistemicState {
  return refs.length === 0 ? "INSUFFICIENT_EVIDENCE" : "PROPOSED";
}

export function insufficientEvidenceAnswer(
  locale: "en" | "he" | "ar" = "en",
  knowledgePlainLanguage?: string | null,
): string {
  const base = REFUSAL[locale] ?? REFUSAL.en;
  if (knowledgePlainLanguage?.includes("INSUFFICIENT_EVIDENCE")) {
    return `${base}\n\n${knowledgePlainLanguage}`;
  }
  return base;
}

export function isInsufficientEvidence(
  epistemic: EpistemicState,
): boolean {
  return epistemic === "INSUFFICIENT_EVIDENCE";
}
