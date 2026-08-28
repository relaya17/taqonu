/**
 * Stage 19 — Agent Marketplace Rankings.
 *
 * Provides rankings and recommendations for which agents to use
 * for specific tasks based on their historical performance.
 *
 * This builds on agent-reputation.ts to provide marketplace-style
 * agent selection guidance.
 */

import {
  FABRIC_AGENT_CATALOG,
  type FabricAgentId,
} from "@atlas/shared";
import {
  computeExpertBattleMetrics,
  type ExpertBattleMetrics,
} from "./agent-reputation.js";

export interface AgentMarketplaceEntry {
  readonly agentId: FabricAgentId;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  
  /** Overall effectiveness score (0-1) */
  readonly effectivenessScore: number;
  
  /** Reliability score based on success rate (0-1) */
  readonly reliabilityScore: number;
  
  /** How specialized vs general (0=generalist, 1=specialist) */
  readonly specializationScore: number;
  
  /** Relative cost per operation */
  readonly costTier: "LOW" | "MEDIUM" | "HIGH";
  
  /** Primary strengths */
  readonly strengths: readonly string[];
  
  /** Known limitations */
  readonly limitations: readonly string[];
  
  /** Best use cases */
  readonly bestFor: readonly string[];
  
  /** Sample size for metrics */
  readonly sampleSize: number;
  
  /** Epistemic state of this ranking */
  readonly epistemicState: "OBSERVED" | "INSUFFICIENT_EVIDENCE";
}

/**
 * Categorize agents by their primary function.
 */
function categorizeAgent(agentId: FabricAgentId): string {
  const agent = FABRIC_AGENT_CATALOG[agentId];
  return agent?.category ?? "General";
}

/**
 * Infer strengths from agent catalog.
 */
function inferStrengths(agentId: FabricAgentId): readonly string[] {
  const agent = FABRIC_AGENT_CATALOG[agentId];
  if (!agent) return [];
  return agent.strengthsEn.slice(0, 3);
}

/**
 * Infer limitations from agent catalog.
 */
function inferLimitations(agentId: FabricAgentId): readonly string[] {
  const agent = FABRIC_AGENT_CATALOG[agentId];
  if (!agent) return [];
  return agent.weaknessesEn.slice(0, 3);
}

/**
 * Infer best use cases from agent role.
 */
function inferBestFor(agentId: FabricAgentId): string[] {
  const useCases: Record<FabricAgentId, string[]> = {
    CODE_ENGINEER: ["Feature implementation", "Bug fixes", "Code refactoring"],
    RESEARCHER: ["Codebase exploration", "Documentation analysis", "Pattern discovery"],
    SECURITY: ["Vulnerability assessment", "Security audits", "Threat modeling"],
    QA: ["Test generation", "Quality validation", "Regression testing"],
    ARCHITECT: ["System design", "Architecture review", "Technical decisions"],
    JUDGE: ["Conflict resolution", "Decision arbitration", "Quality judgment"],
    ORCHESTRATOR: ["Workflow coordination", "Multi-agent tasks", "Process management"],
    LEGAL_MEDIA_COMMS: ["Legal review", "Compliance checks", "Media analysis"],
    DEBUGGER: ["Bug investigation", "Root cause analysis", "Error diagnosis"],
    TEST_ENGINEER: ["Test strategy", "Coverage analysis", "Test automation"],
    OMISSION_DETECTOR: ["Gap analysis", "Missing feature detection", "Completeness check"],
    ADVERSARY: ["Security testing", "Attack simulation", "Vulnerability probing"],
    DATABASE: ["Schema design", "Query optimization", "Data modeling"],
    DEVOPS: ["CI/CD", "Deployment", "Infrastructure"],
    UI_UX: ["Interface design", "User experience", "Accessibility review"],
    ACCESSIBILITY: ["A11y compliance", "Screen reader testing", "WCAG validation"],
  };
  
  return useCases[agentId] ?? ["General purpose tasks"];
}

/**
 * Compute cost tier from agent risk level.
 */
function computeCostTier(agentId: FabricAgentId): "LOW" | "MEDIUM" | "HIGH" {
  const agent = FABRIC_AGENT_CATALOG[agentId];
  if (!agent) return "MEDIUM";
  
  const riskLevel = agent.riskLevel;
  if (riskLevel === "LOW") return "LOW";
  if (riskLevel === "HIGH" || riskLevel === "CRITICAL") return "HIGH";
  return "MEDIUM";
}

/**
 * Build marketplace entry for an agent.
 */
function buildMarketplaceEntry(
  agentId: FabricAgentId,
  metrics: ExpertBattleMetrics,
): AgentMarketplaceEntry {
  const agent = FABRIC_AGENT_CATALOG[agentId];
  
  return {
    agentId,
    displayName: agent?.title ?? agentId,
    description: agent?.specialty ?? "",
    category: categorizeAgent(agentId),
    effectivenessScore: metrics.expertiseScore * 0.4 + metrics.evidenceScore * 0.3 + metrics.verificationSuccessRate * 0.3,
    reliabilityScore: 1 - metrics.falsePositiveRate - metrics.regressionRate,
    specializationScore: agent?.allowedTools.length === 1 ? 1 : 1 / (agent?.allowedTools.length ?? 3),
    costTier: computeCostTier(agentId),
    strengths: inferStrengths(agentId),
    limitations: inferLimitations(agentId),
    bestFor: inferBestFor(agentId),
    sampleSize: metrics.sampleSize,
    epistemicState: metrics.epistemicState,
  };
}

/**
 * Get full marketplace catalog with rankings.
 */
export function getAgentMarketplace(): AgentMarketplaceEntry[] {
  const metrics = computeExpertBattleMetrics();
  
  return metrics
    .map(m => buildMarketplaceEntry(m.agentId, m))
    .sort((a, b) => b.effectivenessScore - a.effectivenessScore);
}

/**
 * Recommend agents for a specific task type.
 */
export function recommendAgentsForTask(taskType: string): AgentMarketplaceEntry[] {
  const marketplace = getAgentMarketplace();
  
  const taskKeywords: Record<string, FabricAgentId[]> = {
    "code": ["CODE_ENGINEER", "ARCHITECT", "QA", "DEBUGGER"],
    "security": ["SECURITY", "ADVERSARY", "JUDGE"],
    "analysis": ["RESEARCHER", "OMISSION_DETECTOR", "DATABASE"],
    "testing": ["QA", "TEST_ENGINEER", "SECURITY"],
    "review": ["JUDGE", "SECURITY", "ARCHITECT"],
    "documentation": ["RESEARCHER", "LEGAL_MEDIA_COMMS"],
    "planning": ["ARCHITECT", "ORCHESTRATOR"],
    "database": ["DATABASE", "ARCHITECT"],
    "devops": ["DEVOPS", "ORCHESTRATOR"],
    "design": ["UI_UX", "ACCESSIBILITY", "ARCHITECT"],
  };
  
  const normalizedTask = taskType.toLowerCase();
  const preferredIds: FabricAgentId[] = [];
  
  for (const [keyword, ids] of Object.entries(taskKeywords)) {
    if (normalizedTask.includes(keyword)) {
      preferredIds.push(...ids);
    }
  }
  
  if (preferredIds.length === 0) {
    return marketplace.slice(0, 3);
  }
  
  return marketplace
    .filter(entry => preferredIds.includes(entry.agentId))
    .slice(0, 3);
}

/**
 * Get agent comparison for selection.
 */
export function compareAgents(
  agentIds: FabricAgentId[],
): AgentMarketplaceEntry[] {
  const marketplace = getAgentMarketplace();
  return marketplace.filter(entry => agentIds.includes(entry.agentId));
}
