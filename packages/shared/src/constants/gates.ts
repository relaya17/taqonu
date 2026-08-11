/** Quality Gate Graph — release readiness DAG (ADR-014 §5). */

export const GATE_STATUSES = [
  "PASS",
  "FAIL",
  "BLOCKED",
  "UNKNOWN",
  "STALE",
  "WAIVED",
] as const;

export type GateStatus = (typeof GATE_STATUSES)[number];

export const DEFAULT_RELEASE_GATE_IDS = [
  "secrets-clean",
  "evidence-present",
  "conflicts-resolved",
  "eval-write-gate",
  "patches-approved",
  "release-ready",
] as const;

export type DefaultReleaseGateId = (typeof DEFAULT_RELEASE_GATE_IDS)[number];

export const DEFAULT_RELEASE_GATE_META: Readonly<
  Record<
    DefaultReleaseGateId,
    { titleEn: string; titleHe: string; blockerHintEn: string }
  >
> = {
  "secrets-clean": {
    titleEn: "Secrets clean",
    titleHe: "אין סודות חשופים",
    blockerHintEn: "Secret redaction / scan must pass before egress.",
  },
  "evidence-present": {
    titleEn: "Evidence present",
    titleHe: "יש ראיות",
    blockerHintEn: "At least one evidence record for the portfolio/project.",
  },
  "conflicts-resolved": {
    titleEn: "Conflicts resolved",
    titleHe: "קונפליקטים סגורים",
    blockerHintEn: "Open conflicts block release readiness.",
  },
  "eval-write-gate": {
    titleEn: "Eval write-gate",
    titleHe: "שער כתיבה (Eval)",
    blockerHintEn: "Latest eval suite must open the write gate (or soft-pass MVP).",
  },
  "patches-approved": {
    titleEn: "Patches approved",
    titleHe: "Patches מאושרים",
    blockerHintEn: "No HIGH/CRITICAL patches awaiting approval.",
  },
  "release-ready": {
    titleEn: "Release ready",
    titleHe: "מוכן לשחרור",
    blockerHintEn: "All upstream gates must PASS or WAIVED.",
  },
};
