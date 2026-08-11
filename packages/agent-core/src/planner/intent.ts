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

const WRITE_HINTS =
  /\b(create pr|open pr|commit|push|deploy|send email|modify files?|update file|write to repo)\b/i;
const PLAN_HINTS =
  /\b(plan|propose|how should|recommend|fix|analyze|מה לתקן|תכנון)\b/i;
const RESUME_HINTS = /\b(continue|resume|where we (left|stopped)|המשך|איפה שעצרנו)\b/i;
const RESEARCH_HINTS = /\b(research|documentation|what is the (current|official))\b/i;
const PORTFOLIO_HINTS = /\b(all (my )?projects|portfolio|compare architecture|כל התיק|כל הפרויקטים)\b/i;
const QA_HINTS =
  /\b(qa|quality|test suite|regression|אבטחת איכות|בדיק|בדוק|תבדוק|اختبار|جودة)\b/i;

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
