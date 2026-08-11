/** Action Engine — classify what kind of work a request needs (Atlas 1.1). */

export const ACTION_KINDS = [
  "CODE_CHANGE",
  "TEST_CHANGE",
  "DOCUMENTATION",
  "CONFIGURATION",
  "INFRASTRUCTURE",
  "EXTERNAL_INTEGRATION",
  "HUMAN_ACTION",
  "UNKNOWN",
] as const;

export type ActionKindName = (typeof ACTION_KINDS)[number];

export const ENGINEERING_LOOP_STAGES = [
  "understand_repository",
  "evidence_collection",
  "impact_analysis",
  "implementation_plan",
  "code_generation",
  "patch_proposal",
  "unit_tests",
  "integration_tests",
  "typecheck",
  "lint",
  "security_checks",
  "expert_council",
  "risk_evaluation",
  "awaiting_human_approval",
  "apply",
  "regression",
  "evidence_update",
  "decision_log",
] as const;

export type EngineeringLoopStage = (typeof ENGINEERING_LOOP_STAGES)[number];

export const LOOP_STAGE_STATUS = [
  "PENDING",
  "RUNNING",
  "PASSED",
  "FAILED",
  "SKIPPED",
  "BLOCKED",
  "AWAITING_APPROVAL",
] as const;

export type LoopStageStatus = (typeof LOOP_STAGE_STATUS)[number];

/** Atlas product truth metrics (north-star KPIs). */
export const ATLAS_PROOF_METRICS = [
  "truth",
  "engineering_success",
  "qa_accuracy",
  "autonomy",
] as const;

export type AtlasProofMetric = (typeof ATLAS_PROOF_METRICS)[number];
