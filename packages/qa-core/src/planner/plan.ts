import {
  DEFAULT_RISK_SEVERITY,
  PROFILE_DOMAIN_MAP,
  type QaDomain,
  type QaEnvironment,
  type QaProfile,
  type QaRiskClass,
  type QaScope,
  type QaSeverity,
} from "@atlas/shared";

export interface PlanQaInput {
  readonly scope: QaScope;
  readonly profile: QaProfile;
  readonly environment: QaEnvironment;
  readonly projectIds: readonly string[];
  readonly changedPaths?: readonly string[];
  readonly userRequest?: string | undefined;
}

export interface QaPlan {
  readonly domains: readonly QaDomain[];
  readonly riskHints: readonly {
    readonly riskClass: QaRiskClass;
    readonly severity: QaSeverity;
    readonly reason: string;
  }[];
  readonly environment: QaEnvironment;
  readonly notes: readonly string[];
}

function inferRisksFromRequest(request: string | undefined): QaPlan["riskHints"] {
  if (!request) {
    return [];
  }
  const lower = request.toLowerCase();
  const hints: QaPlan["riskHints"][number][] = [];
  const push = (riskClass: QaRiskClass, reason: string) => {
    hints.push({
      riskClass,
      severity: DEFAULT_RISK_SEVERITY[riskClass],
      reason,
    });
  };
  if (/auth|התחבר|login|oauth|jwt/.test(lower)) {
    push("AUTHENTICATION", "Request mentions authentication");
  }
  if (/pay|stripe|תשלום|billing/.test(lower)) {
    push("PAYMENTS", "Request mentions payments");
  }
  if (/migrat|database|db|supabase|postgres/.test(lower)) {
    push("DATABASE_MIGRATION", "Request mentions database/migrations");
  }
  if (/secur|אבטח|rls|injection/.test(lower)) {
    push("SECURITY_CONFIG", "Request mentions security");
  }
  if (/ai|prompt|llm|agent|הזיה/.test(lower)) {
    push("AI_PROMPT", "Request mentions AI/agent surface");
  }
  return hints;
}

function inferRisksFromPaths(paths: readonly string[] | undefined): QaPlan["riskHints"] {
  if (!paths?.length) {
    return [];
  }
  const hints: QaPlan["riskHints"][number][] = [];
  const joined = paths.join("\n").toLowerCase();
  if (/auth|middleware|session|rls/.test(joined)) {
    hints.push({
      riskClass: "AUTHENTICATION",
      severity: "HIGH",
      reason: "Changed auth-related paths",
    });
  }
  if (/migration|schema\.sql|supabase\/migrations/.test(joined)) {
    hints.push({
      riskClass: "DATABASE_MIGRATION",
      severity: "CRITICAL",
      reason: "Changed migration/schema paths",
    });
  }
  if (/schema\.ts|openapi|contract/.test(joined)) {
    hints.push({
      riskClass: "API_CONTRACT",
      severity: "HIGH",
      reason: "Changed API/contract paths",
    });
  }
  if (/prompt|agent|llm/.test(joined)) {
    hints.push({
      riskClass: "AI_PROMPT",
      severity: "HIGH",
      reason: "Changed AI/agent paths",
    });
  }
  return hints;
}

/**
 * Test Planner — selects domains/risks. Does not execute tests.
 * PRODUCTION_SAFE never expands into destructive domains.
 */
export function planQaRun(input: PlanQaInput): QaPlan {
  const baseDomains = [...PROFILE_DOMAIN_MAP[input.profile]];
  const notes: string[] = [];

  if (input.environment === "PRODUCTION_SAFE") {
    const allowed = new Set<QaDomain>(["DEPLOYMENT", "API", "FUNCTIONAL"]);
    const filtered = baseDomains.filter((d) => allowed.has(d));
    notes.push("PRODUCTION_SAFE: destructive / mutation domains excluded");
    return {
      domains: filtered.length > 0 ? filtered : ["DEPLOYMENT", "API"],
      riskHints: [
        ...inferRisksFromRequest(input.userRequest),
        ...inferRisksFromPaths(input.changedPaths),
      ],
      environment: input.environment,
      notes,
    };
  }

  if (input.scope === "ENTIRE_PORTFOLIO" && !baseDomains.includes("PORTFOLIO")) {
    baseDomains.push("PORTFOLIO");
    notes.push("Portfolio scope: added PORTFOLIO domain");
  }

  if (input.profile === "CHANGED_ONLY" && (input.changedPaths?.length ?? 0) === 0) {
    notes.push("CHANGED_ONLY without paths — falling back to UNIT+API+REGRESSION");
  }

  return {
    domains: baseDomains,
    riskHints: [
      ...inferRisksFromRequest(input.userRequest),
      ...inferRisksFromPaths(input.changedPaths),
    ],
    environment: input.environment,
    notes,
  };
}
