/**
 * Admin Oracle A1.2 — detect → rank → notify/propose action queue.
 * Derived from watchdog + open remediation drafts. No auto-apply here.
 */
import type { PatchArtifact } from "@atlas/shared";
import type { WatchAlert, WatchdogReport } from "./platform-watchdog.js";
import { osStore } from "../store/os-store.js";
import { isAutoRemediationDraft } from "./patch-write.js";

export type OracleActionKind = "notify" | "investigate" | "propose" | "approve";

export interface OracleQueueAction {
  readonly id: string;
  readonly kind: OracleActionKind;
  readonly priority: number;
  readonly severity: "critical" | "high" | "medium" | "info";
  readonly title: string;
  readonly detail: string;
  readonly evidenceRefs: readonly string[];
  readonly href: string;
  readonly cta: string;
  readonly source: "watchdog" | "remediation" | "deploy" | "truth";
  readonly projectId: string | null;
  readonly blockedAutoApply: boolean;
}

export interface OracleActionQueue {
  readonly generatedAt: string;
  readonly total: number;
  readonly top: readonly OracleQueueAction[];
  readonly counts: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly info: number;
    readonly propose: number;
    readonly notify: number;
  };
  readonly note: string;
}

const SEV_PRIORITY: Record<OracleQueueAction["severity"], number> = {
  critical: 100,
  high: 80,
  medium: 50,
  info: 20,
};

function mapWatchSeverity(
  s: WatchAlert["severity"],
): OracleQueueAction["severity"] {
  return s;
}

function actionFromAlert(alert: WatchAlert): OracleQueueAction {
  const severity = mapWatchSeverity(alert.severity);
  const kind: OracleActionKind =
    severity === "critical" || severity === "high" ? "investigate" : "notify";
  let href = "/admin";
  if (alert.code.includes("WORKSPACE") || alert.code.includes("PROJECT")) {
    href = "/he/projects";
  } else if (alert.code.includes("BYO") || alert.code.includes("QUOTA")) {
    href = "/he/plan";
  } else if (alert.code.includes("EVIDENCE") || alert.code.includes("EPISTEMIC")) {
    href = "/he/truth";
  } else if (alert.code.includes("WATCHDOG")) {
    href = "/admin";
  }

  return {
    id: `watch:${alert.id}`,
    kind,
    priority: SEV_PRIORITY[severity],
    severity,
    title: alert.title,
    detail: alert.detail,
    evidenceRefs: [`watchdog:${alert.code}`, `detectedAt:${alert.detectedAt}`],
    href,
    cta: alert.remediation,
    source: "watchdog",
    projectId: null,
    blockedAutoApply: true,
  };
}

function actionFromPatch(patch: PatchArtifact): OracleQueueAction | null {
  if (
    patch.status === "APPLIED" ||
    patch.status === "VERIFIED" ||
    patch.status === "REJECTED" ||
    patch.status === "ROLLED_BACK"
  ) {
    return null;
  }
  const severity =
    patch.risk === "CRITICAL"
      ? "critical"
      : patch.risk === "HIGH"
        ? "high"
        : patch.risk === "MEDIUM"
          ? "medium"
          : "info";
  const blocked =
    patch.risk === "HIGH" || patch.risk === "CRITICAL";
  const awaiting =
    patch.status === "AWAITING_APPROVAL" ||
    patch.status === "PROPOSED" ||
    patch.status === "DRAFT" ||
    patch.status === "EVALUATED";
  const kind: OracleActionKind = awaiting
    ? patch.approvals.length > 0
      ? "propose"
      : "approve"
    : "investigate";

  return {
    id: `patch:${patch.id}`,
    kind: blocked ? "notify" : kind,
    priority: SEV_PRIORITY[severity] + (awaiting ? 5 : 0),
    severity,
    title: patch.title,
    detail: patch.evaluationSummary ?? patch.reason.slice(0, 400),
    evidenceRefs: [
      `patch:${patch.id}`,
      `risk:${patch.risk}`,
      `status:${patch.status}`,
      ...(patch.sourceIssueId ? [`sourceIssue:${patch.sourceIssueId}`] : []),
    ],
    href: "/he/patches",
    cta: blocked
      ? "HIGH/CRITICAL — recommendation only; human patch required"
      : awaiting
        ? "Approve then Apply under WRITE session"
        : "Open patches queue",
    source: "remediation",
    projectId: patch.projectId,
    blockedAutoApply: blocked || patch.risk !== "LOW",
  };
}

function deployActions(): OracleQueueAction[] {
  const out: OracleQueueAction[] = [];
  for (const project of osStore.listProjects()) {
    const feeds = osStore.getDeployFeeds(project.id);
    const last = feeds.length > 0 ? feeds[feeds.length - 1] : undefined;
    if (!last) continue;
    if (!/error|fail|suspend/i.test(last.status)) continue;
    out.push({
      id: `deploy:${project.id}:${last.observedAt}`,
      kind: "investigate",
      priority: SEV_PRIORITY.high + 2,
      severity: "high",
      title: `Deploy failed · ${last.provider} · ${project.name}`,
      detail: last.summary,
      evidenceRefs: [
        `provider:${last.provider}`,
        `status:${last.status}`,
        `env:${last.environment}`,
        ...(last.commitSha ? [`sha:${last.commitSha}`] : []),
      ],
      href: "/he/truth",
      cta: "Open Truth · review production-deploy finding",
      source: "deploy",
      projectId: project.id,
      blockedAutoApply: true,
    });
  }
  return out;
}

export function buildOracleActionQueue(
  watchdog: WatchdogReport,
): OracleActionQueue {
  const generatedAt = new Date().toISOString();
  const actions: OracleQueueAction[] = [];

  for (const alert of watchdog.alerts) {
    actions.push(actionFromAlert(alert));
  }

  for (const patch of osStore.listPatches()) {
    if (!isAutoRemediationDraft(patch)) continue;
    const a = actionFromPatch(patch);
    if (a) actions.push(a);
  }

  actions.push(...deployActions());

  const ranked = [...actions].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.title.localeCompare(b.title);
  });

  const top = ranked.slice(0, 25);
  const counts = {
    critical: top.filter((a) => a.severity === "critical").length,
    high: top.filter((a) => a.severity === "high").length,
    medium: top.filter((a) => a.severity === "medium").length,
    info: top.filter((a) => a.severity === "info").length,
    propose: top.filter(
      (a) => a.kind === "propose" || a.kind === "approve",
    ).length,
    notify: top.filter(
      (a) => a.kind === "notify" || a.kind === "investigate",
    ).length,
  };

  const queue: OracleActionQueue = {
    generatedAt,
    total: ranked.length,
    top,
    counts,
    note: "Detect→rank→notify/propose only. No silent apply. HIGH/CRITICAL stay human-gated.",
  };

  osStore.setMeta(
    "admin.oracle.queue.last",
    JSON.stringify({
      at: generatedAt,
      total: queue.total,
      critical: counts.critical,
      high: counts.high,
      topIds: top.slice(0, 8).map((a) => a.id),
    }),
  );

  return queue;
}
