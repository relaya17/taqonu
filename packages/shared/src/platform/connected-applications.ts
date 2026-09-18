/**
 * Authoritative runtime connection inventory — connected-app reconciliation.
 *
 * Portfolio seed lists sibling applications. That is not a live execute contract.
 * Do not invent fulfillment mappings. ADR-022 is a hard boundary.
 *
 * Classification is exactly one value per application (Owner directive 2026-09-05).
 */

export const CONNECTED_APPLICATION_IDS = [
  "def-000",
  "civio",
  "caseflow",
  "hotelos",
  "brokeros",
  "lexstudy",
  "vantera",
] as const;

export type ConnectedApplicationId = (typeof CONNECTED_APPLICATION_IDS)[number];

export type ApplicationConnectionKind =
  | "ATLAS_SELF"
  | "HMAC_CONNECTOR"
  | "INVENTORY_ONLY";

export type ApplicationExecuteKind = "GATEWAY_FULFILL" | "NONE";

export type ApplicationIngestKind = "EVALUATE_ONLY" | "NONE";

export type ApplicationPreflightKind = "HMAC_ATLAS_API" | "NONE";

/**
 * Exactly one classification per application.
 * Execute blocked by ADR-022 is recorded on `adr022Conflict`, not as a second class.
 */
export type ConnectedApplicationClassification =
  | "REAL EXECUTION READY"
  | "REAL EXECUTION PARTIALLY IMPLEMENTED"
  | "EVALUATE-ONLY"
  | "INVENTORY ONLY"
  | "BLOCKED BY ADR-022"
  | "BLOCKED BY MISSING CREDENTIALS/INFRASTRUCTURE"
  | "NO VERIFIED CONTRACT";

export interface ConnectedApplicationExecuteGap {
  readonly authentication: "PRESENT" | "ABSENT";
  readonly actions: "PRESENT" | "ABSENT";
  readonly target: "PRESENT" | "ABSENT";
  readonly artifact: "PRESENT" | "ABSENT";
  readonly adr022:
    | "PERMITS_GATEWAY_FULFILL"
    | "PERMITS_EVALUATE_ONLY"
    | "OBSERVE_ONLY";
}

export interface ConnectedApplicationReconciliation {
  readonly classification: ConnectedApplicationClassification;
  readonly authMechanism: string;
  readonly connector: string;
  readonly action: string;
  readonly executionEndpoint: string;
  readonly missingEndpoint: string;
  readonly missingAction: string;
  readonly missingCredential: string;
  readonly adr022Conflict: string;
  readonly siblingObservePath: string | null;
  readonly sourceRepository: string | null;
}

export interface ConnectedApplicationRuntime {
  readonly applicationId: ConnectedApplicationId;
  readonly connection: ApplicationConnectionKind;
  readonly execute: ApplicationExecuteKind;
  readonly ingest: ApplicationIngestKind;
  readonly preflight: ApplicationPreflightKind;
  readonly executeGap: ConnectedApplicationExecuteGap;
  readonly reconciliation: ConnectedApplicationReconciliation;
  readonly evidence: string;
}

const SIBLING_EXECUTE_GAP: ConnectedApplicationExecuteGap = {
  authentication: "ABSENT",
  actions: "ABSENT",
  target: "ABSENT",
  artifact: "ABSENT",
  adr022: "OBSERVE_ONLY",
};

function siblingInventory(
  applicationId: Exclude<
    ConnectedApplicationId,
    "def-000" | "civio"
  >,
  extra: {
    readonly sourceRepository: string;
    readonly siblingObservePath: string | null;
    readonly evidence: string;
    readonly preflight?: ApplicationPreflightKind;
  },
): ConnectedApplicationRuntime {
  return {
    applicationId,
    connection: "INVENTORY_ONLY",
    execute: "NONE",
    ingest: "NONE",
    preflight: extra.preflight ?? "NONE",
    executeGap: SIBLING_EXECUTE_GAP,
    reconciliation: {
      classification: "INVENTORY ONLY",
      authMechanism: "none in this monorepo",
      connector: "none — portfolio seed only",
      action: "none",
      executionEndpoint: "none",
      missingEndpoint: `No Atlas → ${applicationId} authenticated action endpoint`,
      missingAction: "No authoritative tool/action owned by the sibling",
      missingCredential: "Sibling runtime + connector secret/token are not an Atlas execute contract",
      adr022Conflict:
        "ADR-022 keeps CaseFlow, HotelOS, BrokerOS, LexStudy, and Vantera observe-only / not connected. HTTP sibling fulfill is refused.",
      siblingObservePath: extra.siblingObservePath,
      sourceRepository: extra.sourceRepository,
    },
    evidence: extra.evidence,
  };
}

export const CONNECTED_APPLICATION_RUNTIME: readonly ConnectedApplicationRuntime[] =
  [
    {
      applicationId: "def-000",
      connection: "ATLAS_SELF",
      execute: "GATEWAY_FULFILL",
      ingest: "NONE",
      preflight: "NONE",
      executeGap: {
        authentication: "PRESENT",
        actions: "PRESENT",
        target: "PRESENT",
        artifact: "PRESENT",
        adr022: "PERMITS_GATEWAY_FULFILL",
      },
      reconciliation: {
        classification: "REAL EXECUTION READY",
        authMechanism: "operator session or ATLAS_CONTROL_PLANE_TOKEN SERVICE bearer",
        connector: "POST /api/v1/gateway/fulfill",
        action: "request_agent_run → analyze_repo (fabric catalog)",
        executionEndpoint: "POST /api/v1/gateway/fulfill",
        missingEndpoint: "none for Atlas-self catalog tools",
        missingAction: "none for registered production tools",
        missingCredential: "ATLAS_CONTROL_PLANE_TOKEN on API + Control for SERVICE hop",
        adr022Conflict: "none — Atlas-self is the Fabric execution plane",
        siblingObservePath: null,
        sourceRepository: "github/taqonu-main",
      },
      evidence:
        "POST /api/v1/gateway/fulfill → executeGovernedAction. Control Plane does not run tools. request_agent_run requires a live APPROVED RECORD.EXECUTE approval; DOCUMENT.READ does not skip that gate.",
    },
    {
      applicationId: "civio",
      connection: "HMAC_CONNECTOR",
      execute: "NONE",
      ingest: "EVALUATE_ONLY",
      preflight: "HMAC_ATLAS_API",
      executeGap: {
        authentication: "PRESENT",
        actions: "ABSENT",
        target: "ABSENT",
        artifact: "ABSENT",
        adr022: "PERMITS_EVALUATE_ONLY",
      },
      reconciliation: {
        classification: "EVALUATE-ONLY",
        authMechanism: "HMAC ATLAS_CIVIO_CONNECTOR_SECRET + tenant/project bind",
        connector:
          "POST /api/v1/governance/application-preflight (Civio → Atlas) then POST /api/v1/connectors/civio/events (evaluate-only evidence)",
        action: "none — CIVIO_SUPPORTED_ACTIONS is empty; Atlas does not execute Civio",
        executionEndpoint: "none",
        missingEndpoint: "No Atlas → Civio inbound action URL in Atlas or in github.com/relaya17/civio",
        missingAction: "CIVIO_SUPPORTED_ACTIONS = [] ; events have no tool/target/artifact",
        missingCredential:
          "Live Civio runtime needs ATLAS_CIVIO_* plus ATLAS_PREFLIGHT_URL / ATLAS_API_URL on Civio",
        adr022Conflict:
          "ADR-022: Control evaluates ingest and does not execute tools on ingest. Atlas-to-Civio inbound is NOT_IMPLEMENTED. Preflight is Civio→Atlas authorization, not sibling execute.",
        siblingObservePath: "Civio emitCivioEventToControl → HMAC ingest (evaluate-only evidence after preflight)",
        sourceRepository: "github.com/relaya17/civio",
      },
      evidence:
        "POST /api/v1/governance/application-preflight HMAC-binds civio. ALLOW is required before Civio Gemini (improve/scan/legal-query), community forum AI, and housing-agent Gemini. HMAC ingest remains evaluate-only. inboundAtlasToCivio is NOT_IMPLEMENTED.",
    },
    siblingInventory("caseflow", {
      sourceRepository: "github/CaseFlow-AI-main",
      preflight: "HMAC_ATLAS_API",
      siblingObservePath:
        "CaseFlow getOpenAIClient wrap + aiGateway/claude/whisper/analyst assertAtlasPreflight → POST /api/v1/governance/application-preflight. Post-action emitArletOsEvent → POST /api/v1/gateway/events remains observe.",
      evidence:
        "Local sibling github/CaseFlow-AI-main. OpenAI chat/embeddings, Anthropic, Whisper, and security-analyst HTTP are gated. Atlas still has no CaseFlow execute action/target/artifact.",
    }),
    siblingInventory("hotelos", {
      sourceRepository: "github/hotelOS-AI-main",
      preflight: "HMAC_ATLAS_API",
      siblingObservePath:
        "HotelOS createAiGateway().invoke assertAtlasPreflight → POST /api/v1/governance/application-preflight. atlas-telemetry → gateway/events remains observe.",
      evidence:
        "Local sibling github/hotelOS-AI-main. Gateway invoke and embed are the gated AI chokes. No inbound HotelOS execute contract.",
    }),
    siblingInventory("brokeros", {
      sourceRepository: "github/brokerOS-main",
      preflight: "HMAC_ATLAS_API",
      siblingObservePath:
        "BrokerOS callGeminiForJson and draftInvoiceFromText assertAtlasPreflight → POST /api/v1/governance/application-preflight. Copilot/listing/price/tRPC use the shared Gemini helper.",
      evidence:
        "Local sibling github/brokerOS-main. Shared Gemini JSON helper and draft-invoice REST caller are gated. Atlas still has no BrokerOS execute contract.",
    }),
    siblingInventory("lexstudy", {
      sourceRepository: "github/LexStudy-main",
      siblingObservePath: null,
      evidence:
        "NOT ACCESSIBLE on this workstation. Contract is POST /api/v1/governance/application-preflight with applicationId=lexstudy once the runtime is reachable. No implementation claimed.",
    }),
    siblingInventory("vantera", {
      sourceRepository: "github/vantera",
      siblingObservePath: null,
      evidence:
        "NOT ACCESSIBLE on this workstation. Contract is POST /api/v1/governance/application-preflight with applicationId=vantera once the runtime is reachable. No implementation claimed.",
    }),
  ];

export function getConnectedApplicationRuntime(
  applicationId: string,
): ConnectedApplicationRuntime | undefined {
  return CONNECTED_APPLICATION_RUNTIME.find((row) => row.applicationId === applicationId);
}

export function applicationMayExecuteViaGateway(applicationId: string): boolean {
  return getConnectedApplicationRuntime(applicationId)?.execute === "GATEWAY_FULFILL";
}

export function connectedApplicationClassifications(): Readonly<
  Record<ConnectedApplicationId, ConnectedApplicationClassification>
> {
  return Object.fromEntries(
    CONNECTED_APPLICATION_RUNTIME.map((row) => [row.applicationId, row.reconciliation.classification]),
  ) as Record<ConnectedApplicationId, ConnectedApplicationClassification>;
}
