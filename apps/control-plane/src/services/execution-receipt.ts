import { createHash, randomUUID } from "node:crypto";

export type ExecutionKind = "OBSERVATION" | "HANDED_OFF_GOVERNED" | "NONE";

export type ReceiptVerificationVerdict =
  | "VERIFIED"
  | "FAILED"
  | "PARTIAL"
  | "INCONCLUSIVE"
  | "BLOCKED";

export interface ExecutionReceipt {
  readonly receiptId: string;
  readonly requestId: string;
  readonly applicationId: string;
  readonly operation: string;
  readonly agentId: string | null;
  readonly decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  readonly executed: boolean;
  readonly executionKind: ExecutionKind;
  readonly observation: Record<string, unknown> | null;
  readonly verification: {
    readonly verdict: ReceiptVerificationVerdict;
    readonly detail: string;
  };
  readonly artifactHash: string;
  /** Contract for apps/api executeGovernedAction — never executed inside the Control Plane. */
  readonly governedHandoff: {
    readonly entityType: string;
    readonly action: string;
    readonly toolName: string;
  } | null;
}

export function hashReceiptArtifact(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function newReceiptIds(): { readonly receiptId: string; readonly requestId: string } {
  return { receiptId: randomUUID(), requestId: randomUUID() };
}
