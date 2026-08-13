/**
 * Platform watchdog — proactive signals before users hit hard failures.
 * Pure analysis over OS store + plan meters; no network side-effects.
 */

import {
  PLAN_AXIS_LIMITS,
  PLATFORM_VERSION,
  STORAGE_POLICY_VERSION,
  type PlanTier,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";

export type WatchSeverity = "critical" | "high" | "medium" | "info";

export interface WatchAlert {
  readonly id: string;
  readonly severity: WatchSeverity;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly remediation: string;
  readonly detectedAt: string;
}

export interface KnowledgeGraphSummary {
  readonly projects: number;
  readonly evidenceRecords: number;
  readonly claims: number;
  readonly memories: number;
  readonly decisions: number;
  readonly patches: number;
  readonly agentRuns: number;
  readonly processAuditsToday: number;
  readonly linkedWorkspaces: number;
  readonly byoCloudConnected: number;
  readonly epistemicUnknownProjects: number;
}

export interface AutomationPulse {
  readonly lastWatchdogAt: string | null;
  readonly lastPortfolioHealthAt: string | null;
  readonly lastProcessAuditAt: string | null;
  readonly recommendedIntervalMinutes: number;
  readonly overdue: boolean;
}

export interface WatchdogReport {
  readonly generatedAt: string;
  readonly platformVersion: string;
  readonly storagePolicyVersion: string;
  readonly alertCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly alerts: readonly WatchAlert[];
  readonly knowledge: KnowledgeGraphSummary;
  readonly automation: AutomationPulse;
  readonly score: number;
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readMetaTime(key: string): string | null {
  const raw = osStore.getMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at?: string };
    return typeof parsed.at === "string" ? parsed.at : null;
  } catch {
    return raw.length > 0 ? raw : null;
  }
}

function countMapEntries(
  map: Map<string, readonly unknown[]>,
): number {
  let n = 0;
  for (const list of map.values()) n += list.length;
  return n;
}

export function buildKnowledgeGraphSummary(): KnowledgeGraphSummary {
  osStore.ensureLoaded();
  const projects = osStore.listProjects();
  let linkedWorkspaces = 0;
  for (const p of projects) {
    const root = osStore.getWorkspaceRoot(p.id);
    if (root) linkedWorkspaces += 1;
  }

  return {
    projects: projects.length,
    evidenceRecords: osStore.countEvidenceRecords(),
    claims: countMapEntries(osStore.claims),
    memories: countMapEntries(osStore.memories),
    decisions: countMapEntries(osStore.decisions),
    patches: osStore.listPatches().length,
    agentRuns: osStore.listAgentRuns().length,
    processAuditsToday: osStore.getProcessAuditsToday(dayKey()),
    linkedWorkspaces,
    byoCloudConnected: osStore.countConnectedByoCloudBindings(),
    epistemicUnknownProjects: projects.filter((p) => {
      const snap = osStore.getSnapshot(p.id);
      return !snap || snap.overallEpistemicState === "UNKNOWN";
    }).length,
  };
}

export function runPlatformWatchdog(input?: {
  readonly tier?: PlanTier;
  readonly ownerId?: string | null;
}): WatchdogReport {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const tier = input?.tier ?? "free";
  const axes = PLAN_AXIS_LIMITS[tier];
  const knowledge = buildKnowledgeGraphSummary();
  const alerts: WatchAlert[] = [];

  const push = (
    severity: WatchSeverity,
    code: string,
    title: string,
    detail: string,
    remediation: string,
  ) => {
    alerts.push({
      id: `watch-${code.toLowerCase()}`,
      severity,
      code,
      title,
      detail,
      remediation,
      detectedAt: now,
    });
  };

  if (knowledge.projects === 0) {
    push(
      "high",
      "NO_PROJECTS",
      "No projects registered",
      "The portfolio is empty — audits and verdicts cannot run.",
      "Import a repo under Partners or Projects.",
    );
  }

  if (knowledge.projects > 0 && knowledge.linkedWorkspaces === 0) {
    push(
      "critical",
      "NO_WORKSPACE_ROOTS",
      "No local workspace roots linked",
      `${knowledge.projects} project(s) exist but none have workspaceRoot — Studio, Workbench, and deep E2E stay blocked.`,
      "On Projects, set an absolute local folder path per project.",
    );
  } else if (
    knowledge.projects > 0 &&
    knowledge.linkedWorkspaces < knowledge.projects
  ) {
    push(
      "medium",
      "PARTIAL_WORKSPACES",
      "Some projects lack local paths",
      `${knowledge.linkedWorkspaces}/${knowledge.projects} projects have workspaceRoot.`,
      "Link remaining folders so audits can read real code.",
    );
  }

  if (knowledge.byoCloudConnected === 0) {
    push(
      "high",
      "BYO_CLOUD_DISCONNECTED",
      "Customer cloud (Cloudflare) not connected",
      "Free tier expects BYO Cloudflare — without it, data residency policy is incomplete.",
      "Connect Cloudflare on /plan (Pricing & BYO cloud).",
    );
  }

  if (knowledge.evidenceRecords === 0 && knowledge.projects > 0) {
    push(
      "medium",
      "NO_EVIDENCE",
      "Evidence graph is empty",
      "Projects exist but no evidence records — verdicts will stay thin.",
      "Run health / process audit / GitHub sync to populate evidence.",
    );
  }

  if (knowledge.epistemicUnknownProjects > 0) {
    push(
      "medium",
      "EPISTEMIC_UNKNOWN",
      "Projects stuck in UNKNOWN epistemic state",
      `${knowledge.epistemicUnknownProjects} project(s) have UNKNOWN state snapshots.`,
      "Run reconcile / portfolio discovery sync.",
    );
  }

  const evalUsed = osStore.getEvalRunsToday(dayKey());
  if (evalUsed / axes.evalRunsPerDay >= 0.8) {
    push(
      "high",
      "EVAL_QUOTA_PRESSURE",
      "Eval quota near limit",
      `${evalUsed}/${axes.evalRunsPerDay} eval runs used today (${tier}).`,
      "Upgrade to Pro or wait for daily reset.",
    );
  }

  const auditUsed = osStore.getProcessAuditsToday(dayKey());
  if (auditUsed / axes.processAuditsPerDay >= 0.8) {
    push(
      "high",
      "PROCESS_AUDIT_QUOTA_PRESSURE",
      "Process-audit quota near limit",
      `${auditUsed}/${axes.processAuditsPerDay} process audits used today (${tier}).`,
      "Upgrade usage on Pro or spread audits across days.",
    );
  }

  const agentUsed = osStore.getAgentMessagesToday(dayKey());
  if (agentUsed / axes.agentMessagesPerDay >= 0.8) {
    push(
      "medium",
      "AGENT_QUOTA_PRESSURE",
      "Agent message quota near limit",
      `${agentUsed}/${axes.agentMessagesPerDay} agent messages used today (${tier}).`,
      "Upgrade to Pro for higher agent ceilings.",
    );
  }

  const lastWatchdogAt = readMetaTime("admin.watchdog.last");
  const lastPortfolioHealthAt = readMetaTime("admin.portfolioHealth.last");
  const lastProcessAuditAt = readMetaTime("admin.processAudit.last");
  const recommendedIntervalMinutes = 60;
  let overdue = true;
  if (lastWatchdogAt) {
    const ageMs = Date.now() - Date.parse(lastWatchdogAt);
    overdue = Number.isFinite(ageMs)
      ? ageMs > recommendedIntervalMinutes * 60_000
      : true;
  }
  if (overdue) {
    push(
      "info",
      "WATCHDOG_OVERDUE",
      "Scheduled watchdog check overdue",
      lastWatchdogAt
        ? `Last run at ${lastWatchdogAt}.`
        : "Watchdog has never been run on this instance.",
      "Open Admin → Automation and run checks (or POST /api/v1/admin/automation/run-checks).",
    );
  }

  const severityWeight: Record<WatchSeverity, number> = {
    critical: 25,
    high: 12,
    medium: 6,
    info: 2,
  };
  const penalty = alerts.reduce(
    (sum, a) => sum + severityWeight[a.severity],
    0,
  );
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const highCount = alerts.filter((a) => a.severity === "high").length;

  const report: WatchdogReport = {
    generatedAt: now,
    platformVersion: PLATFORM_VERSION,
    storagePolicyVersion: STORAGE_POLICY_VERSION,
    alertCount: alerts.length,
    criticalCount,
    highCount,
    alerts: alerts.sort((a, b) => {
      const order: Record<WatchSeverity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        info: 3,
      };
      return order[a.severity] - order[b.severity];
    }),
    knowledge,
    automation: {
      lastWatchdogAt,
      lastPortfolioHealthAt,
      lastProcessAuditAt,
      recommendedIntervalMinutes,
      overdue,
    },
    score,
  };

  osStore.setMeta(
    "admin.watchdog.last",
    JSON.stringify({ at: now, score, alertCount: alerts.length }),
  );

  return report;
}
