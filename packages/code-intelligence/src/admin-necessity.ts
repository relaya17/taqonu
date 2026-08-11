/**
 * Admin Necessity Intelligence (Atlas Product Rule)
 *
 * Admin is a business/security need — not a fixed technical default.
 * Atlas must detect WHETHER admin is needed, WHAT type, and HOW to separate —
 * not scaffold /admin into every project.
 */

export type AdminSurfaceKind =
  | "NONE"
  | "IN_APP_ROUTE"
  | "SEPARATE_FRONTEND"
  | "RBAC_ONLY";

export type AdminRoleType =
  | "INTERNAL"
  | "CUSTOMER"
  | "SUPER"
  | "SUPPORT"
  | "OPERATIONS"
  | "FINANCE"
  | "CONTENT"
  | "SECURITY";

export interface AdminNecessitySignals {
  /** Business/security signals that justify administrative capabilities. */
  readonly needsAdmin: boolean;
  readonly needReasons: readonly string[];
  /** UI or route that looks like an admin console. */
  readonly hasAdminUi: boolean;
  /** Server-side authorization for admin/sensitive actions. */
  readonly hasServerAuthz: boolean;
  /** Client-only role gating without evident API enforcement. */
  readonly frontendOnlyRisk: boolean;
  /** Audit / append-only admin action logging signal. */
  readonly hasAdminAudit: boolean;
  readonly inferredSurface: AdminSurfaceKind;
  readonly suggestedRoleTypes: readonly AdminRoleType[];
}

const NEED_PATTERNS: readonly { reason: string; re: RegExp }[] = [
  { reason: "user_management", re: /manage\s+users|user\s+roles|listUsers|admin\/users|RBAC|permission/i },
  { reason: "sensitive_data_mutation", re: /service[_-]?role|impersonat|override|force.?delete/i },
  { reason: "finance", re: /billing|invoice|refund|payout|ledger|stripe\.admin/i },
  { reason: "audit_logs", re: /audit\s*log|appendAudit|compliance\s*log/i },
  { reason: "tenant_ops", re: /tenant|multi-tenant|organization\s*admin|workspace\s*admin/i },
  { reason: "support", re: /support\s*console|customer\s*support|impersonate/i },
  { reason: "content_cms", re: /cms|content\s*admin|moderat/i },
  { reason: "security_ops", re: /security\s*center|threat|ban\s*user|revoke\s*session/i },
  { reason: "monitoring_ops", re: /ops\s*dashboard|on-?call|incident\s*console/i },
];

/**
 * Analyze repo text/file names for admin necessity — never “always add admin”.
 */
export function analyzeAdminNecessity(input: {
  readonly blob: string;
  readonly names: string;
}): AdminNecessitySignals {
  const blob = `${input.blob}\n${input.names}`;
  const needReasons = NEED_PATTERNS.filter((p) => p.re.test(blob)).map(
    (p) => p.reason,
  );
  const needsAdmin = needReasons.length > 0;

  const hasAdminUi =
    /\/admin\b|app\/admin|apps\/admin|admin\.app\.|AdminConsole|AdminShell/i.test(
      blob,
    ) || /(^|\/)admin(\/|$)/i.test(input.names);

  const hasSeparateAdminApp =
    /admin\.(app|localhost)|apps\/admin|packages\/admin-web/i.test(blob);

  const hasServerAuthz =
    /requireAdmin|requireRole|role\s*===\s*['\"]admin['\"]|FORBIDDEN.*[Aa]dmin|assertAdmin|isAdmin\(|authorize\(.*admin/i.test(
      blob,
    ) &&
    /(routes\/|apps\/api|server\/|middleware)/i.test(blob);

  const hasClientRoleGate =
    /user\.role\s*===\s*['\"]admin['\"]|role\s*===\s*['\"]admin['\"].*(useQuery|useEffect|router\.push)/i.test(
      blob,
    ) ||
    (/role\s*===\s*['\"]admin['\"]/i.test(blob) &&
      /app\/\[locale\]|apps\/web|components\//i.test(blob));

  const frontendOnlyRisk = hasAdminUi && hasClientRoleGate && !hasServerAuthz;

  const hasAdminAudit =
    /appendAudit|audit\.log|admin\.action|AuditLog|audit_trail/i.test(blob);

  let inferredSurface: AdminSurfaceKind = "NONE";
  if (hasSeparateAdminApp) inferredSurface = "SEPARATE_FRONTEND";
  else if (hasAdminUi) inferredSurface = "IN_APP_ROUTE";
  else if (needsAdmin && hasServerAuthz) inferredSurface = "RBAC_ONLY";

  const suggestedRoleTypes: AdminRoleType[] = [];
  if (needReasons.includes("user_management") || needReasons.includes("tenant_ops")) {
    suggestedRoleTypes.push("INTERNAL", "SUPER");
  }
  if (needReasons.includes("support")) suggestedRoleTypes.push("SUPPORT");
  if (needReasons.includes("finance")) suggestedRoleTypes.push("FINANCE");
  if (needReasons.includes("content_cms")) suggestedRoleTypes.push("CONTENT");
  if (needReasons.includes("security_ops")) suggestedRoleTypes.push("SECURITY");
  if (needReasons.includes("monitoring_ops")) suggestedRoleTypes.push("OPERATIONS");
  if (needReasons.includes("tenant_ops")) suggestedRoleTypes.push("CUSTOMER");

  return {
    needsAdmin,
    needReasons,
    hasAdminUi,
    hasServerAuthz,
    frontendOnlyRisk,
    hasAdminAudit,
    inferredSurface,
    suggestedRoleTypes: [...new Set(suggestedRoleTypes)],
  };
}

export function adminNecessitySummary(s: AdminNecessitySignals): string {
  if (!s.needsAdmin && !s.hasAdminUi) {
    return "No admin capability required by evidence — do not scaffold /admin by default.";
  }
  if (!s.needsAdmin && s.hasAdminUi) {
    return `Admin UI observed (${s.inferredSurface}) without clear business need signals — confirm type or remove complexity.`;
  }
  if (s.needsAdmin && !s.hasServerAuthz) {
    return `Admin capability needed (${s.needReasons.join(", ")}) but server authorization not evidenced. Types to consider: ${s.suggestedRoleTypes.join(", ") || "INTERNAL"}.`;
  }
  if (s.frontendOnlyRisk) {
    return "Admin UI with client role checks but weak server enforcement — /admin is not security.";
  }
  return `Admin need evidenced (${s.needReasons.join(", ")}); surface=${s.inferredSurface}; serverAuthz=${s.hasServerAuthz}; audit=${s.hasAdminAudit}.`;
}
