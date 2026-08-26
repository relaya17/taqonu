/**
 * Atlas self-audit (DEF-000) — detect and propose, never auto-apply.
 */
import { controlPlaneToken } from "../control-plane-auth.js";
import { listRegisteredApplications } from "./application-registry.js";
import { listRegisteredAgents } from "./agent-registry.js";
import {
  listApprovalRecords,
  verifyAuditChain,
} from "./governance-state.js";

export interface SelfAuditFinding {
  readonly id: string;
  readonly severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly title: string;
  readonly evidence: string;
  readonly recommendation: string;
  readonly autoApply: false;
}

export interface SelfAuditReport {
  readonly systemId: "DEF-000";
  readonly generatedAt: string;
  readonly workflow: "observe-diagnose-propose-approve-apply-verify-audit";
  readonly findings: readonly SelfAuditFinding[];
}

export function runSelfAudit(): SelfAuditReport {
  const findings: SelfAuditFinding[] = [];
  const production = process.env["NODE_ENV"] === "production";
  const token = controlPlaneToken();

  if (production && !token) {
    findings.push({
      id: "cp-token-missing",
      severity: "CRITICAL",
      title: "Control Plane token missing in production",
      evidence: "NODE_ENV=production and ATLAS_CONTROL_PLANE_TOKEN is empty",
      recommendation: "Set ATLAS_CONTROL_PLANE_TOKEN and restart. Do not expose :3100.",
      autoApply: false,
    });
  } else {
    findings.push({
      id: "cp-auth-bound",
      severity: "INFO",
      title: "Control Plane authentication bound",
      evidence: token ? "Bearer token configured" : "Dev loopback-only without token",
      recommendation: "Keep production token-only; never grant operator via /admin/users.",
      autoApply: false,
    });
  }

  const chain = verifyAuditChain();
  if (!chain.ok) {
    findings.push({
      id: "audit-chain-break",
      severity: "HIGH",
      title: "Audit chain verification failed",
      evidence: chain.error ?? "unknown break",
      recommendation: "Export and investigate. Do not rewrite history.",
      autoApply: false,
    });
  } else {
    findings.push({
      id: "audit-append-only",
      severity: "INFO",
      title: "Audit trail verifies",
      evidence: `${chain.checked} entries chained; DELETE/PUT/PATCH remain 405`,
      recommendation: "Keep append/read/export/verify only.",
      autoApply: false,
    });
  }

  const apps = listRegisteredApplications();
  const hasSelf = apps.some((app) => app.applicationId === "def-000");
  findings.push({
    id: "def-000-present",
    severity: hasSelf ? "INFO" : "HIGH",
    title: hasSelf ? "Atlas is registered as DEF-000" : "DEF-000 missing from application registry",
    evidence: `applications=${apps.length}`,
    recommendation: hasSelf
      ? "Continue treating Atlas as a Managed System."
      : "Re-seed the application registry.",
    autoApply: false,
  });

  const agents = listRegisteredAgents();
  const missingCaps = agents.filter((a) => a.deniedCapabilities.length === 0);
  if (missingCaps.length > 0) {
    findings.push({
      id: "agent-denied-caps",
      severity: "MEDIUM",
      title: "Agent missing explicit denied capabilities",
      evidence: missingCaps.map((a) => a.agentId).join(", "),
      recommendation: "Every agent must list denied capabilities (never agent=admin).",
      autoApply: false,
    });
  } else {
    findings.push({
      id: "agent-caps-explicit",
      severity: "INFO",
      title: "Agents have explicit allow/deny capabilities",
      evidence: `${agents.length} registered agents`,
      recommendation: "Keep secrets.read / audit.delete denied for all fabric agents.",
      autoApply: false,
    });
  }

  return {
    systemId: "DEF-000",
    generatedAt: new Date().toISOString(),
    workflow: "observe-diagnose-propose-approve-apply-verify-audit",
    findings,
  };
}

export function ownerBrief(): {
  readonly whatChanged: readonly string[];
  readonly pendingApprovals: number;
  readonly openFindings: readonly SelfAuditFinding[];
  readonly recommendations: readonly string[];
  readonly requiresYourApproval: readonly string[];
} {
  const report = runSelfAudit();
  const pending = listApprovalRecords({ status: "PENDING" });
  const open = report.findings.filter(
    (f) => f.severity === "HIGH" || f.severity === "CRITICAL" || f.severity === "MEDIUM",
  );
  const apps = listRegisteredApplications();
  const whatChanged = apps
    .filter((a) => a.lastEventType)
    .map((a) => `${a.name}: ${a.lastEventType} (${a.lastEventAt ?? "unknown"})`);

  return {
    whatChanged,
    pendingApprovals: pending.length,
    openFindings: open,
    recommendations: report.findings.map((f) => f.recommendation),
    requiresYourApproval: [
      ...pending.map((p) => `${p.entityType}.${p.action} (${p.id})`),
      ...open.map((f) => f.title),
    ],
  };
}
