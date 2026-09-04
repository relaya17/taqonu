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
      evidence: token ? "Control-plane token configured" : "Dev loopback-only without token",
      recommendation: "Keep production token-only; never grant operator via /admin/users.",
      autoApply: false,
    });
  }

  const chain = verifyAuditChain();
  findings.push({
    id: "audit-canonical-is-api",
    severity: "INFO",
    title: "Control Plane audit is non-canonical",
    evidence: chain.note,
    recommendation:
      "Treat apps/api NDJSON as the system of record. Do not merge CP hashes into a second SoR.",
    autoApply: false,
  });
  if (!chain.ok) {
    findings.push({
      id: "audit-chain-break",
      severity: "HIGH",
      title: "Control Plane observational audit is internally inconsistent",
      evidence: chain.error ?? "unknown break",
      recommendation: "Export and investigate. Do not rewrite history.",
      autoApply: false,
    });
  }

  findings.push({
    id: "cp-mfa-not-bound",
    severity: "INFO",
    title: "Control Plane browser MFA uses tenant TOTP; service bearers use rotation",
    evidence:
      "Privileged browser login on Control and Admin completes existing /auth/mfa/verify. HMAC reauth tickets remain one-shot and are not TOTP. Service bearers accept current plus ATLAS_CONTROL_PLANE_TOKEN_PREVIOUS.",
    recommendation:
      "Keep production private; rotate with PREVIOUS overlapping current; do not put TOTP on machine bearers.",
    autoApply: false,
  });

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

  findings.push({
    id: "egress-policy-present",
    severity: "INFO",
    title: "Egress policy is the existing decideEgress table",
    evidence:
      "SECRET/SYSTEM_CRITICAL never leave Atlas; LLM/EXPORT/WEBHOOK/EMAIL/TELEMETRY share that table. No second policy engine.",
    recommendation: "Keep wrapping new outbound paths with assertEgressAllowed, not a new gate.",
    autoApply: false,
  });

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
