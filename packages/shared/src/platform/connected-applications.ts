/**
 * Authoritative runtime connection inventory.
 *
 * Portfolio seed lists sibling applications. That is not a live connector
 * and not an execute contract. Do not invent fulfillment mappings.
 *
 * ADR-022: Control evaluates Civio ingest and does not execute tools on ingest.
 * Atlas-self (`def-000`) is the only application with HTTP gateway fulfill.
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

export interface ConnectedApplicationRuntime {
  readonly applicationId: ConnectedApplicationId;
  readonly connection: ApplicationConnectionKind;
  readonly execute: ApplicationExecuteKind;
  readonly ingest: ApplicationIngestKind;
  readonly executeGap: ConnectedApplicationExecuteGap;
  readonly evidence: string;
}

export const CONNECTED_APPLICATION_RUNTIME: readonly ConnectedApplicationRuntime[] =
  [
    {
      applicationId: "def-000",
      connection: "ATLAS_SELF",
      execute: "GATEWAY_FULFILL",
      ingest: "NONE",
      evidence:
        "POST /api/v1/gateway/fulfill → executeGovernedAction. Control Plane does not run tools.",
      executeGap: {
        authentication: "PRESENT",
        actions: "PRESENT",
        target: "PRESENT",
        artifact: "PRESENT",
        adr022: "PERMITS_GATEWAY_FULFILL",
      },
    },
    {
      applicationId: "civio",
      connection: "HMAC_CONNECTOR",
      execute: "NONE",
      ingest: "EVALUATE_ONLY",
      evidence:
        "POST /api/v1/connectors/civio/events evaluates. ALLOW ≠ EXECUTED. No authoritative tool/target/artifact on Civio events. CIVIO_SUPPORTED_ACTIONS is empty. Atlas-to-Civio inbound is NOT_IMPLEMENTED.",
      executeGap: {
        authentication: "PRESENT",
        actions: "ABSENT",
        target: "ABSENT",
        artifact: "ABSENT",
        adr022: "PERMITS_EVALUATE_ONLY",
      },
    },
    {
      applicationId: "caseflow",
      connection: "INVENTORY_ONLY",
      execute: "NONE",
      ingest: "NONE",
      evidence: "Portfolio Governance seed only. ADR-022 observe-only. No connector, HMAC, tool, target, or artifact.",
      executeGap: {
        authentication: "ABSENT",
        actions: "ABSENT",
        target: "ABSENT",
        artifact: "ABSENT",
        adr022: "OBSERVE_ONLY",
      },
    },
    {
      applicationId: "hotelos",
      connection: "INVENTORY_ONLY",
      execute: "NONE",
      ingest: "NONE",
      evidence: "Portfolio Governance seed only. ADR-022 observe-only. No connector, HMAC, tool, target, or artifact.",
      executeGap: {
        authentication: "ABSENT",
        actions: "ABSENT",
        target: "ABSENT",
        artifact: "ABSENT",
        adr022: "OBSERVE_ONLY",
      },
    },
    {
      applicationId: "brokeros",
      connection: "INVENTORY_ONLY",
      execute: "NONE",
      ingest: "NONE",
      evidence: "Portfolio Governance seed only. ADR-022 observe-only. No connector, HMAC, tool, target, or artifact.",
      executeGap: {
        authentication: "ABSENT",
        actions: "ABSENT",
        target: "ABSENT",
        artifact: "ABSENT",
        adr022: "OBSERVE_ONLY",
      },
    },
    {
      applicationId: "lexstudy",
      connection: "INVENTORY_ONLY",
      execute: "NONE",
      ingest: "NONE",
      evidence: "Portfolio Governance seed only. ADR-022 observe-only. No connector, HMAC, tool, target, or artifact.",
      executeGap: {
        authentication: "ABSENT",
        actions: "ABSENT",
        target: "ABSENT",
        artifact: "ABSENT",
        adr022: "OBSERVE_ONLY",
      },
    },
    {
      applicationId: "vantera",
      connection: "INVENTORY_ONLY",
      execute: "NONE",
      ingest: "NONE",
      evidence: "Portfolio Governance seed only. ADR-022 observe-only. No connector, HMAC, tool, target, or artifact.",
      executeGap: {
        authentication: "ABSENT",
        actions: "ABSENT",
        target: "ABSENT",
        artifact: "ABSENT",
        adr022: "OBSERVE_ONLY",
      },
    },
  ];

export function getConnectedApplicationRuntime(
  applicationId: string,
): ConnectedApplicationRuntime | undefined {
  return CONNECTED_APPLICATION_RUNTIME.find((row) => row.applicationId === applicationId);
}

export function applicationMayExecuteViaGateway(applicationId: string): boolean {
  return getConnectedApplicationRuntime(applicationId)?.execute === "GATEWAY_FULFILL";
}
