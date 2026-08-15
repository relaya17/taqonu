import {
  type ManagedSystem,
  type SystemContract,
  type SystemContractVerification,
  type SystemContractWrite,
  type SystemInvariant,
} from "@atlas/shared";

const DEFAULT_APPROVALS = [
  "WRITE is approval-gated (ADR-015)",
  "HIGH / CRITICAL never auto-apply",
  "Financial or production ACT requires a human",
];

const DEFAULT_EVIDENCE = [
  "No evidence = no strong claim",
  "Exists in code ≠ proven in production",
  "VERIFY before ACT",
];

export function defaultLedgerInvariant(): SystemInvariant {
  return {
    id: "ledger-zero-gap",
    statement:
      "Every building ledger must reconcile to a ₪0 gap before the day closes.",
    domain: "FINANCIAL",
    requiredEvidence: ["stripe-webhook", "ledger-row", "worker-run"],
    approvalRequired: true,
  };
}

export function defaultSystemContract(
  system: Pick<ManagedSystem, "id" | "name" | "kind" | "slug">,
  asOf = new Date().toISOString(),
): SystemContract {
  const self = system.kind === "ATLAS_SELF";
  return {
    systemId: system.id,
    identity: `${system.name} (${system.slug})`,
    architecture: self
      ? "Truth + Evidence + Governance + Intelligence + Automation Control over connectors"
      : null,
    dependencies: self
      ? ["github", "local", "vercel", "render", "supabase", "mongodb"]
      : [],
    criticalWorkflows: self
      ? ["observe", "reconcile", "gated-write", "self-audit"]
      : [],
    financialInvariants: [],
    securityPolicies: [
      "Secrets redacted before LLM egress",
      "No cross-tenant learning on customer code",
    ],
    dataBoundaries: [
      "Customer code stays in workspace / BYO storage",
      "Connectors observe from outside — Atlas does not embed in product code",
    ],
    slos: [],
    recoveryObjectives: [],
    approvalPolicies: DEFAULT_APPROVALS,
    evidenceRequirements: DEFAULT_EVIDENCE,
    epistemicState: "PROPOSED",
    updatedAt: asOf,
  };
}

function tokenHits(required: string, evidenceTokens: readonly string[]): boolean {
  const needle = required.trim().toLowerCase();
  if (!needle) return false;
  return evidenceTokens.some((token) => {
    const hay = token.toLowerCase();
    return hay === needle || hay.includes(needle);
  });
}

/** PASS only when every requiredEvidence token is present in observed evidence. */
export function verifySystemInvariants(input: {
  contract: SystemContract;
  evidenceTokens: readonly string[];
  asOf?: string;
}): SystemContractVerification {
  const asOf = input.asOf ?? new Date().toISOString();
  const results = input.contract.financialInvariants.map((invariant) => {
    const presentEvidence = invariant.requiredEvidence.filter((req) =>
      tokenHits(req, input.evidenceTokens),
    );
    const missingEvidence = invariant.requiredEvidence.filter(
      (req) => !presentEvidence.includes(req),
    );
    let status: "PASS" | "FAIL" | "UNKNOWN";
    if (missingEvidence.length === 0) {
      status = "PASS";
    } else if (input.contract.epistemicState === "CONFIRMED") {
      status = "FAIL";
    } else {
      status = "UNKNOWN";
    }
    return {
      id: invariant.id,
      statement: invariant.statement,
      status,
      missingEvidence,
      presentEvidence,
    };
  });

  let overall: "PASS" | "FAIL" | "UNKNOWN";
  if (results.some((row) => row.status === "FAIL")) {
    overall = "FAIL";
  } else if (results.length > 0 && results.every((row) => row.status === "PASS")) {
    overall = "PASS";
  } else {
    overall = "UNKNOWN";
  }

  return {
    systemId: input.contract.systemId,
    overall,
    results,
    asOf,
  };
}

export function mergeSystemContract(
  current: SystemContract,
  patch: SystemContractWrite,
  asOf = new Date().toISOString(),
): SystemContract {
  const next: SystemContract = {
    ...current,
    updatedAt: asOf,
  };
  if (patch.identity !== undefined) next.identity = patch.identity;
  if (patch.architecture !== undefined) next.architecture = patch.architecture;
  if (patch.dependencies !== undefined) next.dependencies = patch.dependencies;
  if (patch.criticalWorkflows !== undefined) {
    next.criticalWorkflows = patch.criticalWorkflows;
  }
  if (patch.financialInvariants !== undefined) {
    next.financialInvariants = patch.financialInvariants;
  }
  if (patch.securityPolicies !== undefined) {
    next.securityPolicies = patch.securityPolicies;
  }
  if (patch.dataBoundaries !== undefined) next.dataBoundaries = patch.dataBoundaries;
  if (patch.slos !== undefined) next.slos = patch.slos;
  if (patch.recoveryObjectives !== undefined) {
    next.recoveryObjectives = patch.recoveryObjectives;
  }
  if (patch.approvalPolicies !== undefined) {
    next.approvalPolicies = patch.approvalPolicies;
  }
  if (patch.evidenceRequirements !== undefined) {
    next.evidenceRequirements = patch.evidenceRequirements;
  }
  if (patch.epistemicState !== undefined) next.epistemicState = patch.epistemicState;
  return next;
}
