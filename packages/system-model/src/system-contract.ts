import {
  type ManagedSystem,
  type SystemContract,
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
