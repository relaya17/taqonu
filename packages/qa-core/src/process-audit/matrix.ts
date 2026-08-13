import type {
  ExpertId,
  ProcessAppProfile,
  ProcessDimension,
  ProcessGateId,
  ProcessProviderTarget,
} from "@atlas/shared";
import { PROCESS_SPECIALIST_EXPERTS } from "@atlas/shared";
import { APP_PROFILE_SPECS } from "./profiles.js";

export interface MatrixRow {
  readonly id: string;
  readonly gateId: ProcessGateId | null;
  readonly dimension: ProcessDimension;
  readonly actor: string;
  readonly action: string;
  readonly expected: "PASS" | "DENY" | "HITL_WAIT" | "AUDIT";
  readonly specialist: ExpertId;
}

const PROVIDER_CATALOG: Readonly<
  Record<
    ProcessProviderTarget,
    { status: "live" | "feed" | "mvp" | "planned"; note: string }
  >
> = {
  github: { status: "live", note: "Full observe → evidence" },
  local: { status: "live", note: "Local workspace scan" },
  vercel: { status: "live", note: "Deployment observe + feeds" },
  netlify: {
    status: "planned",
    note: "Adapter planned — integrate via observe feed",
  },
  render: { status: "live", note: "Deployment observe + feeds" },
  supabase: { status: "feed", note: "DB feed observation" },
  mongodb: { status: "feed", note: "DB feed observation" },
  ci: { status: "mvp", note: "SARIF / CI security evidence" },
  sentry: { status: "planned", note: "Error observation planned" },
  stripe: { status: "planned", note: "Billing events planned" },
};

export function specialistsForProcess(
  _appProfile: ProcessAppProfile,
  includeUiUx: boolean,
): ExpertId[] {
  const base = [...PROCESS_SPECIALIST_EXPERTS] as ExpertId[];
  if (!includeUiUx) {
    return base.filter((e) => e !== "UI_UX" && e !== "VISUAL_DESIGN");
  }
  return base;
}

export function buildProcessMatrix(appProfile: ProcessAppProfile): MatrixRow[] {
  const spec = APP_PROFILE_SPECS[appProfile];
  const rows: MatrixRow[] = [];

  for (const journey of spec.journeys) {
    rows.push({
      id: `entry-${journey.id}`,
      gateId: "GATE_1_CORRECT_ENTRY",
      dimension: "AUTH_JOURNEY",
      actor: journey.actor,
      action: `Full E2E: ${journey.steps.join(" → ")}`,
      expected: "PASS",
      specialist: "QA",
    });
  }

  rows.push(
    {
      id: "rbac-pos",
      gateId: "GATE_2_AUTHORIZATION",
      dimension: "RBAC",
      actor: "Authorized role",
      action: "Allowed API/action for role",
      expected: "PASS",
      specialist: "SECURITY",
    },
    {
      id: "rbac-neg",
      gateId: "GATE_2_AUTHORIZATION",
      dimension: "RBAC",
      actor: "Unauthorized role",
      action: "Same API/action without permission",
      expected: "DENY",
      specialist: "SECURITY",
    },
  );

  if (spec.isolationRequired) {
    rows.push(
      {
        id: "tenant-read",
        gateId: "GATE_3_TENANT_ISOLATION",
        dimension: "TENANT_ISOLATION",
        actor: "Tenant A admin",
        action: "Read Tenant B resources",
        expected: "DENY",
        specialist: "SECURITY",
      },
      {
        id: "tenant-ai",
        gateId: "GATE_3_TENANT_ISOLATION",
        dimension: "AI_HITL",
        actor: "Tenant A user",
        action: "AI retrieve Tenant B data (retrieval layer must block)",
        expected: "DENY",
        specialist: "SECURITY",
      },
    );
  }

  rows.push(
    {
      id: "e2e-mutation",
      gateId: "GATE_4_REAL_E2E_ACTION",
      dimension: "BUSINESS_E2E",
      actor: "Primary admin",
      action: "Browser → API → Auth → RBAC → DB → Audit → UI refresh",
      expected: "AUDIT",
      specialist: "QA",
    },
    {
      id: "ui-comfort",
      gateId: null,
      dimension: "UI_UX",
      actor: "End user",
      action: "Comfort, clarity, mobile, empty/error states, task ≤2 taps",
      expected: "PASS",
      specialist: "UI_UX",
    },
    {
      id: "perf",
      gateId: null,
      dimension: "PERFORMANCE",
      actor: "End user",
      action: "Key journey latency / perceived speed",
      expected: "PASS",
      specialist: "DEVOPS",
    },
    {
      id: "a11y",
      gateId: null,
      dimension: "ACCESSIBILITY",
      actor: "Assistive tech user",
      action: "Keyboard, contrast, labels on critical flows",
      expected: "PASS",
      specialist: "ACCESSIBILITY",
    },
    {
      id: "visual",
      gateId: null,
      dimension: "VISUAL_DESIGN",
      actor: "Brand / design",
      action: "Visual hierarchy, tokens, Photoshop/Figma handoff readiness",
      expected: "PASS",
      specialist: "VISUAL_DESIGN",
    },
  );

  if (spec.aiHitlLikely) {
    rows.push(
      {
        id: "ai-deny",
        gateId: "GATE_2_AUTHORIZATION",
        dimension: "AI_HITL",
        actor: "Low-privilege user",
        action: "Ask AI for privileged data",
        expected: "DENY",
        specialist: "SECURITY",
      },
      {
        id: "hitl",
        gateId: "GATE_4_REAL_E2E_ACTION",
        dimension: "AI_HITL",
        actor: "AI agent",
        action: "Destructive/financial action → propose → human approve once",
        expected: "HITL_WAIT",
        specialist: "QA",
      },
    );
  }

  return rows;
}

export function providerStatusesForProfile(appProfile: ProcessAppProfile): Array<{
  provider: ProcessProviderTarget;
  adapterStatus: "live" | "feed" | "mvp" | "planned" | "missing";
  relevant: boolean;
  note: string;
}> {
  const hints = new Set(
    APP_PROFILE_SPECS[appProfile].providerHints.map((h) => h.toLowerCase()),
  );
  return (Object.keys(PROVIDER_CATALOG) as ProcessProviderTarget[]).map(
    (provider) => {
      const meta = PROVIDER_CATALOG[provider];
      return {
        provider,
        adapterStatus: meta.status,
        relevant:
          hints.has(provider) || provider === "github" || provider === "local",
        note: meta.note,
      };
    },
  );
}
