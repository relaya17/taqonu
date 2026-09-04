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
  },
): ConnectedApplicationRuntime {
  return {
    applicationId,
    connection: "INVENTORY_ONLY",
    execute: "NONE",
    ingest: "NONE",
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
        "POST /api/v1/gateway/fulfill → executeGovernedAction. Control Plane does not run tools. Live proof executed analyze_repo.",
    },
    {
      applicationId: "civio",
      connection: "HMAC_CONNECTOR",
      execute: "NONE",
      ingest: "EVALUATE_ONLY",
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
        connector: "POST /api/v1/connectors/civio/events (Civio → Atlas)",
        action: "none — CIVIO_SUPPORTED_ACTIONS is empty",
        executionEndpoint: "none",
        missingEndpoint: "No Atlas → Civio inbound action URL in Atlas or in github.com/relaya17/civio",
        missingAction: "CIVIO_SUPPORTED_ACTIONS = [] ; events have no tool/target/artifact",
        missingCredential:
          "Live Civio runtime needs ATLAS_CIVIO_* on both runtimes; that still does not create an execute action",
        adr022Conflict:
          "ADR-022: Control evaluates ingest and does not execute tools on ingest. Atlas-to-Civio inbound is NOT_IMPLEMENTED.",
        siblingObservePath: "Civio emitCivioEventToControl → HMAC ingest (evaluate-only)",
        sourceRepository: "github.com/relaya17/civio",
      },
      evidence:
        "POST /api/v1/connectors/civio/events evaluates. ALLOW ≠ EXECUTED. Civio local repo only implements outbound emit. inboundAtlasToCivio is NOT_IMPLEMENTED.",
    },
    siblingInventory("caseflow", {
      sourceRepository: "github/CaseFlow-AI-main",
      siblingObservePath:
        "CaseFlow arletOsGatewayClient emitArletOsEvent → POST /api/v1/gateway/events (observe). CaseFlow /api/atlas is that product's engineering-audit UI, not taqonu execute.",
      evidence:
        "Portfolio seed github/CaseFlow-AI-main. Local sibling has outbound gateway/events client and an internal /api/atlas module (name collision). No Atlas → CaseFlow action/target/artifact.",
    }),
    siblingInventory("hotelos", {
      sourceRepository: "github/hotelOS-AI-main",
      siblingObservePath:
        "HotelOS atlas-telemetry → POST /api/v1/gateway/events (one-way). intelligenceApiAvailable is hardcoded false (HotelOS ADR 0016).",
      evidence:
        "Portfolio seed github/hotelOS-AI-main. Sibling telemetry is HotelOS → Atlas observe. No inbound HotelOS execute contract. ADR-022 observe-only.",
    }),
    siblingInventory("brokeros", {
      sourceRepository: "github/brokerOS",
      siblingObservePath: null,
      evidence:
        "Portfolio seed only. fixtures/golden-brokeros is an exemplar, not a connector. Local github/brokerOS was not present on this workstation.",
    }),
    siblingInventory("lexstudy", {
      sourceRepository: "github/LexStudy-main",
      siblingObservePath: null,
      evidence:
        "Portfolio seed only. ADR-022 observe-only. Local github/LexStudy-main was not present on this workstation.",
    }),
    siblingInventory("vantera", {
      sourceRepository: "github/vantera",
      siblingObservePath: null,
      evidence:
        "Portfolio seed only. Vantera's own product named Atlas is a knowledge service, not taqonu execute. Local github/vantera was not present on this workstation.",
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
