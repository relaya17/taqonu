/** Engineering agent modes — ADR-015 (UI /he/agent). */

export const ENGINEERING_AGENT_MODES = [
  "analyze",
  "plan",
  "generate",
  "fix",
  "refactor",
  "test",
  "secure",
  "optimize",
  "implement",
] as const;

export type EngineeringAgentMode = (typeof ENGINEERING_AGENT_MODES)[number];

export const ENGINEERING_MODE_META: Readonly<
  Record<
    EngineeringAgentMode,
    { titleEn: string; titleHe: string; proposesPatch: boolean }
  >
> = {
  analyze: {
    titleEn: "Analyze",
    titleHe: "ניתוח",
    proposesPatch: false,
  },
  plan: {
    titleEn: "Plan",
    titleHe: "תכנון",
    proposesPatch: false,
  },
  generate: {
    titleEn: "Generate",
    titleHe: "יצירה",
    proposesPatch: true,
  },
  fix: {
    titleEn: "Fix",
    titleHe: "תיקון",
    proposesPatch: true,
  },
  refactor: {
    titleEn: "Refactor",
    titleHe: "רפקטור",
    proposesPatch: true,
  },
  test: {
    titleEn: "Test",
    titleHe: "בדיקות",
    proposesPatch: true,
  },
  secure: {
    titleEn: "Secure",
    titleHe: "אבטחה",
    proposesPatch: true,
  },
  optimize: {
    titleEn: "Optimize",
    titleHe: "אופטימיזציה",
    proposesPatch: true,
  },
  implement: {
    titleEn: "Implement",
    titleHe: "יישום מלא",
    proposesPatch: true,
  },
};
