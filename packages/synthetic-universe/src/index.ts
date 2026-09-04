export { SANDBOX_CONTROLS, SandboxPolicyError, sandboxControls } from "./policy.js";
export { SyntheticTenantManager } from "./tenant.js";
export { SyntheticDataGenerator } from "./generator.js";
export { SyntheticUniverse } from "./runner.js";
export { simulateExternal, attemptRealExternal } from "./simulation.js";
export { authorizeSyntheticAction, atlasEntityTypeFor } from "./authorization.js";
export {
  REAL_ESTATE_DEAL_COMPLETION,
  REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT,
  HOTEL_RESERVATION,
  PROPERTY_MAINTENANCE,
  CRM_LEAD_DEAL,
  ATLAS_SELF_TEST_UNAUTHORIZED,
  SANDBOX_CONTAINMENT_PAYMENT,
  DOMAIN_SCENARIOS,
  REGISTERED_SCENARIOS,
  SYNTHETIC_SCENARIO_RUN_PATH,
  SYNTHETIC_SCENARIO_CLOSED_LOOP_PATH,
  failureScenario,
  resolveRegisteredScenario,
  remediatingScenarioId,
  resolveRemediatingScenario,
} from "./catalog.js";
export { diagnoseFailure } from "./diagnosis.js";
export { planRemediation } from "./remediation.js";
export { runClosedLoop } from "./closed-loop.js";
export { resolveDomain } from "./tenant.js";
export { syntheticEntityId, looksSyntheticId } from "./ids.js";
export type {
  SyntheticTenantRecord,
  SyntheticEntity,
  SyntheticEvent,
  ScenarioDefinition,
  ScenarioVerdict,
  FailureInjectionId,
} from "./types.js";
export type { ScenarioEvidence } from "./evidence.js";
export type { ScenarioRunResult } from "./runner.js";
export type { FailureDiagnosis, FailureClass } from "./diagnosis.js";
export type { RemediationPlan, RemediationStep } from "./remediation.js";
export type {
  ClosedLoopResult,
  ClosedLoopVerdict,
  ClosedLoopGovernance,
  RecoveryVerification,
} from "./closed-loop.js";
