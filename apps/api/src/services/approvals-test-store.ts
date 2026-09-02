import { LiveApprovalRequestRepository } from "@atlas/database";
import { createInProcessLiveApprovalClient } from "../../../../packages/database/src/repositories/live-approval-requests.in-process.js";
import { configureLiveApprovalStore } from "./approvals.js";

export { createInProcessLiveApprovalClient };

/**
 * Test-only installer for an isolated in-process live-approval backend.
 * Production `approvals.ts` never imports or constructs this client.
 */
export function resetApprovalsForTests(): void {
  configureLiveApprovalStore(
    new LiveApprovalRequestRepository(createInProcessLiveApprovalClient()),
  );
}
