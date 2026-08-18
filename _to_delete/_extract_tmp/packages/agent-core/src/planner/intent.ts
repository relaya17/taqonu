import type { AgentMode } from "@atlas/shared";

export type IntentKind =
  | "ANALYZE"
  | "RESUME"
  | "RESEARCH"
  | "PLAN_CHANGE"
  | "WRITE_CHANGE"
  | "PORTFOLIO_HEALTH"
  | "QA_RUN"
  | "UNKNOWN";

export interface ClassifiedIntent {
  readonly kind: IntentKind;
  readonly suggestedMode: AgentMode;
  readonly requiresApproval: boolean;
}

// Plain \b relies on \w, which in JS only covers [A-Za-z0-9_] — it never
// treats Hebrew/Arabic letters as "word" characters. That silently breaks
// any \b-wrapped Hebrew/Arabic alternative (it can never satisfy the
// boundary next to non-Latin text), so every non-Latin hint below used to
// be dead code. \p{L}/\p{N} lookaround boundaries are Unicode-aware and
// work for every script.
const WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const WORD_AFTER = "(?![\\p{L}\\p{N}_])";
function wordBoundary(alternation: string): RegExp {
  return new RegExp(`${WORD_BEFORE}(?:${alternation})${WORD_AFTER}`, "iu");
}

const WRITE_HINTS = wordBoundary(
  "create pr|open pr|commit|push|deploy|send email|modify files?|update file|write to repo",
);
const PLAN_HINTS = wordBoundary(
  "plan|propose|how should|recommend|fix|analyze|מה לתקן|תכנון",
);
const RESUME_HINTS = wordBoundary(
  "continue|resume|where we (?:left|stopped)|המשך|איפה שעצרנו",
);
const RESEARCH_HINTS = wordBoundary(
  "research|documentation|what is the (?:current|official)",
);
const PORTFOLIO_HINTS = wordBoundary(
  "all (?:my )?projects|portfolio|compare architecture|כל התיק|כל הפרויקטים",
);
const QA_HINTS = wordBoundary(
  "qa|quality|test suite|regression|אבטחת איכות|בדיק|בדוק|תבדוק|اختبار|جودة",
);

export function classifyIntent(request: string): ClassifiedIntent {
  if (RESUME_HINTS.test(request)) {
    return { kind: "RESUME", suggestedMode: "READ", requiresApproval: false };
  }
  if (QA_HINTS.test(request)) {
    return { kind: "QA_RUN", suggestedMode: "ANALYZE", requiresApproval: false };
  }
  if (PORTFOLIO_HINTS.test(request)) {
    return {
      kind: "PORTFOLIO_HEALTH",
      suggestedMode: "READ",
      requiresApproval: false,
    };
  }
  if (WRITE_HINTS.test(request)) {
    return { kind: "WRITE_CHANGE", suggestedMode: "WRITE", requiresApproval: true };
  }
  if (PLAN_HINTS.test(request)) {
    return { kind: "PLAN_CHANGE", suggestedMode: "PLAN", requiresApproval: true };
  }
  if (RESEARCH_HINTS.test(request)) {
    return { kind: "RESEARCH", suggestedMode: "READ", requiresApproval: false };
  }
  if (request.trim().length > 0) {
    return { kind: "ANALYZE", suggestedMode: "ANALYZE", requiresApproval: false };
  }
  return { kind: "UNKNOWN", suggestedMode: "READ", requiresApproval: false };
}
