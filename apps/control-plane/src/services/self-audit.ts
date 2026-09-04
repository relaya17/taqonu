/**
 * Atlas self-audit (DEF-000) — detect and propose, never auto-apply.
 */
import {
  agentMayExecute,
  FABRIC_AGENT_CATALOG,
  FABRIC_AGENT_IDS,
  PRODUCTION_IMPLEMENTED_TOOLS,
} from "@atlas/shared";
import { controlPlaneToken } from "../control-plane-auth.js";
import { listRegisteredApplications } from "./application-registry.js";
import { listRegisteredAgents } from "./agent-registry.js";
import {
  getAuditEntryCount,
  listApprovalRecords,
  listAuditEntries,
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

function finding(
  id: string,
  severity: SelfAuditFinding["severity"],
  title: string,
  evidence: string,
  recommendation: string,
): SelfAuditFinding {
  return { id, severity, title, evidence, recommendation, autoApply: false };
}

export function catalogToolNames(): readonly string[] {
  const names = new Set<string>();
  for (const id of FABRIC_AGENT_IDS) {
    for (const tool of FABRIC_AGENT_CATALOG[id].allowedTools) {
      names.add(tool);
    }
  }
  return [...names].sort();
}

export function detectCatalogRegistrationDrift(): SelfAuditFinding {
  const catalog = new Set(catalogToolNames());
  const unimplementedExpected = PRODUCTION_IMPLEMENTED_TOOLS.filter((tool) => !catalog.has(tool));
  if (unimplementedExpected.length > 0) {
    return finding(
      "catalog-registration-drift",
      "HIGH",
      "Production-registered tool is absent from the Fabric catalog",
      `tools=${unimplementedExpected.join(", ")}`,
      "Do not register a production tool that no catalog agent is allowed to invoke.",
    );
  }
  return finding(
    "catalog-registration-aligned",
    "INFO",
    "Production implemented tools are granted in the Fabric catalog",
    `production=${PRODUCTION_IMPLEMENTED_TOOLS.join(", ")}`,
    "Keep startup registration aligned with this closed list. Catalog names outside it stay fail-closed.",
  );
}

export function detectPolicyWithoutImplementation(): SelfAuditFinding {
  const catalog = catalogToolNames();
  const unimplemented = catalog.filter(
    (tool) => !(PRODUCTION_IMPLEMENTED_TOOLS as readonly string[]).includes(tool),
  );
  return finding(
    "policy-without-implementation",
    "INFO",
    "Catalog tools without a production implementation remain fail-closed",
    unimplemented.length > 0
      ? `unregisteredCatalogTools=${unimplemented.join(", ")}`
      : "every catalog tool has a production implementation",
    "A catalog grant is not execution authority. executeTool denies policy-without-implementation.",
  );
}

export function detectCpApiStatusEnforcementDrift(): SelfAuditFinding {
  const agents = listRegisteredAgents();
  const halted = agents.filter((agent) => !agentMayExecute(agent.status));
  const apiUrl = process.env["ATLAS_API_URL"]?.trim() ?? "";
  if (halted.length === 0) {
    return finding(
      "cp-api-status-aligned",
      "INFO",
      "No non-executable Control Plane overlay is currently applied",
      `oversightAgents=${agents.length}; ATLAS_API_URL=${apiUrl ? "set" : "unset"}`,
      "API resolveGovernedAgentIdentity must keep consulting GET /api/v1/agents/:id.",
    );
  }
  return finding(
    "cp-api-status-mismatch",
    "MEDIUM",
    "Control Plane overlay blocks execution; API must not default those agents to ACTIVE",
    `halted=${halted.map((agent) => `${agent.agentId}=${agent.status}`).join(", ")}; ATLAS_API_URL=${apiUrl ? "set" : "unset"}`,
    "Keep the overlay. API executeGovernedAction denies non-executable runtimeStatus. Do not invent a second authorization system.",
  );
}

export function detectMissingAuditEvidence(): SelfAuditFinding {
  const chain = verifyAuditChain();
  const count = getAuditEntryCount();
  if (!chain.ok || count === 0) {
    return finding(
      "missing-audit-evidence",
      count === 0 ? "MEDIUM" : "HIGH",
      "Control Plane observational audit evidence is missing or inconsistent",
      `count=${count}; ok=${String(chain.ok)}; note=${chain.note}; error=${chain.error ?? "none"}`,
      "Treat apps/api NDJSON as the system of record. Do not rewrite CP hashes into a second SoR.",
    );
  }
  return finding(
    "audit-evidence-present",
    "INFO",
    "Control Plane observational audit has entries",
    `count=${count}; canonical=false`,
    "Keep importing CP hashes into the API chain. Do not treat this trail as canonical.",
  );
}

export function detectVerificationGaps(): SelfAuditFinding {
  const gateway = listAuditEntries({ type: "gateway." });
  const verified = listAuditEntries({ type: "verification.completed" });
  const executedLike = gateway.filter((entry) => entry.result === "SUCCESS");
  if (executedLike.length > 0 && verified.length === 0) {
    return finding(
      "verification-gap",
      "MEDIUM",
      "Gateway success entries exist without a matching verification.completed observation",
      `gatewaySuccess=${executedLike.length}; verificationCompleted=${verified.length}`,
      "ALLOW is not VERIFIED. Keep world-state verification on the API fulfill hop.",
    );
  }
  return finding(
    "verification-observations-present",
    "INFO",
    "No unmatched gateway-success / verification observation gap detected",
    `gatewayEntries=${gateway.length}; verificationCompleted=${verified.length}`,
    "Continue treating executed:true as insufficient for verified:true.",
  );
}

export function detectGovernanceStateInconsistency(): SelfAuditFinding {
  const pending = listApprovalRecords({ status: "PENDING" });
  const now = Date.now();
  const expiredPending = pending.filter((record) => Date.parse(record.expiresAt) < now);
  if (expiredPending.length > 0) {
    return finding(
      "governance-state-inconsistency",
      "MEDIUM",
      "PENDING Control Plane approval records are already past expiresAt",
      `expiredPending=${expiredPending.map((record) => record.id).join(", ")}`,
      "Investigate. Self-audit must not expire or consume these records.",
    );
  }
  return finding(
    "governance-state-consistent",
    "INFO",
    "No expired-but-PENDING Control Plane approval records detected",
    `pending=${pending.length}`,
    "Live approvals remain on the API store. This trail is observational.",
  );
}

export function detectRuntimeConfigDrift(): SelfAuditFinding {
  const production = process.env["NODE_ENV"] === "production";
  const apiUrl = process.env["ATLAS_API_URL"]?.trim() ?? "";
  const token = controlPlaneToken();
  if (production && (!apiUrl || !token)) {
    return finding(
      "runtime-config-drift",
      "CRITICAL",
      "Production Control Plane is missing API handoff configuration",
      `NODE_ENV=production; ATLAS_API_URL=${apiUrl ? "set" : "unset"}; token=${token ? "set" : "unset"}`,
      "Set ATLAS_API_URL and ATLAS_CONTROL_PLANE_TOKEN. Missing config must fail closed, not execute locally.",
    );
  }
  return finding(
    "runtime-config-bound",
    "INFO",
    "Runtime Control Plane API handoff configuration is present or this is non-production",
    `NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}; ATLAS_API_URL=${apiUrl ? "set" : "unset"}`,
    "Do not add a distributed worker or Redis because this hop is unset.",
  );
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
      "Privileged browser login completes /auth/mfa/verify. Production or ATLAS_CONTROL_PLANE_REQUIRE_BROWSER_MFA=1 refuses gateway/ops and agent-control from a password-only session. HMAC reauth tickets remain one-shot and are not TOTP. Service bearers accept current plus PREVIOUS and are not TOTP-bound.",
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

  const halted = agents.filter((agent) => !agentMayExecute(agent.status));
  findings.push({
    id: "agent-runtime-overlay",
    severity: halted.length > 0 ? "MEDIUM" : "INFO",
    title:
      halted.length > 0
        ? "Control Plane runtime overlay is blocking one or more oversight agents"
        : "No non-executable Control Plane runtime overlay is applied",
    evidence:
      halted.length > 0
        ? halted.map((agent) => `${agent.agentId}=${agent.status}`).join(", ")
        : `${agents.length} oversight agents are executable`,
    recommendation:
      "API executeGovernedAction now denies non-executable runtimeStatus. Confirm the overlay is intentional.",
    autoApply: false,
  });

  findings.push({
    id: "cp-does-not-execute-tools",
    severity: "INFO",
    title: "Control Plane does not execute tools",
    evidence:
      "CP evaluate + callAtlasApi handoff only. Tool implementations register on the tenant API and run only through executeGovernedAction.",
    recommendation: "Do not add executeTool to Control Plane.",
    autoApply: false,
  });

  findings.push({
    id: "fabric-vs-oversight-registry",
    severity: "INFO",
    title: "Fabric catalog remains the execution identity; CP /agents is oversight",
    evidence:
      "GET /api/v1/agents is the 9-item oversight list. A 404 overlay lookup means no CP circuit-break for that fabric id (defaults ACTIVE). Unreachable CP fail-closes as UNKNOWN.",
    recommendation:
      "Quarantine CODE_ENGINEER (and other oversight ids) on CP when execution must stop. Do not merge Fabric into the oversight list.",
    autoApply: false,
  });

  findings.push(detectCatalogRegistrationDrift());
  findings.push(detectPolicyWithoutImplementation());
  findings.push(detectCpApiStatusEnforcementDrift());
  findings.push(detectMissingAuditEvidence());
  findings.push(detectVerificationGaps());
  findings.push(detectGovernanceStateInconsistency());
  findings.push(detectRuntimeConfigDrift());

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
