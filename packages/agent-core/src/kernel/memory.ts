import {
  engineeringLessonSchema,
  improvementRuleSchema,
  type EngineeringLesson,
  type ImprovementRule,
} from "@atlas/shared";

const lessons: EngineeringLesson[] = [];
const rules: ImprovementRule[] = [];

function seed() {
  if (lessons.length > 0) return;
  const now = new Date().toISOString();
  lessons.push(
    engineeringLessonSchema.parse({
      id: crypto.randomUUID(),
      pattern: "WEBHOOK_IDEMPOTENCY",
      title: "External webhooks need idempotency",
      summary:
        "idempotency key + unique constraint + retry policy + audit event",
      evidenceProjectSlug: "brokeros",
      applicableDomains: ["payments", "CRM", "integrations"],
      occurrences: 3,
      createdAt: now,
      updatedAt: now,
      epistemicState: "INFERRED",
    }),
    engineeringLessonSchema.parse({
      id: crypto.randomUUID(),
      pattern: "AUTHZ_DEFENSE",
      title: "AuthZ defense in depth",
      summary: "API authZ + RLS + audit event",
      evidenceProjectSlug: null,
      applicableDomains: ["API", "security", "multi-tenant"],
      occurrences: 2,
      createdAt: now,
      updatedAt: now,
      epistemicState: "INFERRED",
    }),
  );
}

/** P9 — Long-term engineering memory (patterns only, no raw leakage). */
export function listEngineeringLessons(): EngineeringLesson[] {
  seed();
  return [...lessons];
}

export function recordEngineeringLesson(input: {
  pattern: string;
  title: string;
  summary: string;
  evidenceProjectSlug?: string | null;
  applicableDomains?: string[];
}): EngineeringLesson {
  seed();
  const existing = lessons.find((l) => l.pattern === input.pattern);
  if (existing) {
    const updated = engineeringLessonSchema.parse({
      ...existing,
      occurrences: existing.occurrences + 1,
      updatedAt: new Date().toISOString(),
      summary: input.summary || existing.summary,
    });
    const idx = lessons.findIndex((l) => l.id === existing.id);
    lessons[idx] = updated;
    return updated;
  }
  const now = new Date().toISOString();
  const lesson = engineeringLessonSchema.parse({
    id: crypto.randomUUID(),
    pattern: input.pattern,
    title: input.title,
    summary: input.summary,
    evidenceProjectSlug: input.evidenceProjectSlug ?? null,
    applicableDomains: input.applicableDomains ?? [],
    occurrences: 1,
    createdAt: now,
    updatedAt: now,
    epistemicState: "INFERRED",
  });
  lessons.push(lesson);
  return lesson;
}

export function listImprovementRules(): ImprovementRule[] {
  return [...rules];
}

/**
 * P10 — Self-improvement: repeated lessons → policy rule for future agents.
 */
export function runSelfImprovement(): {
  created: ImprovementRule[];
  scannedLessons: number;
} {
  seed();
  const created: ImprovementRule[] = [];
  for (const lesson of lessons) {
    if (lesson.occurrences < 2) continue;
    if (rules.some((r) => r.pattern === lesson.pattern)) continue;
    const rule = improvementRuleSchema.parse({
      id: crypto.randomUUID(),
      pattern: lesson.pattern,
      rule: `Future agents MUST check pattern ${lesson.pattern}: ${lesson.summary}`,
      sourceLessonIds: [lesson.id],
      autoCheckAgents:
        lesson.pattern.includes("AUTH") || lesson.pattern.includes("WEBHOOK")
          ? ["SECURITY", "CODE_ENGINEER", "QA"]
          : ["QA", "ARCHITECT"],
      createdAt: new Date().toISOString(),
      epistemicState: "INFERRED",
    });
    rules.push(rule);
    created.push(rule);
  }
  return { created, scannedLessons: lessons.length };
}

export function matchLessonsForRequest(request: string): string[] {
  seed();
  const q = request.toLowerCase();
  return lessons
    .filter(
      (l) =>
        q.includes(l.pattern.toLowerCase()) ||
        l.applicableDomains.some((d) => q.includes(d.toLowerCase())) ||
        (/webhook|idempot/.test(q) && l.pattern.includes("WEBHOOK")) ||
        (/auth|secur|rls/.test(q) && l.pattern.includes("AUTH")),
    )
    .map((l) => l.pattern);
}
