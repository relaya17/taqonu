import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-r05-attribution-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const {
  listUnifiedAuditEntries,
  setAuditLogPathForTests,
  verifyAuditLogChain,
} = await import("./audit-log.js");
const { createApprovalRequest, decideApprovalRequest } = await import("./approvals.js");
const { resetApprovalsForTests } = await import("./approvals-test-store.js");

describe("R05 remaining writer attribution", () => {
  beforeEach(() => {
    setAuditLogPathForTests(join(tmpDir, `audit-${Date.now()}-${Math.random()}.ndjson`));
    resetApprovalsForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
  });

  it("does not fabricate tenantId or projectId on approval writers", async () => {
    const created = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "22222222-2222-4222-8222-222222222222",
      reason: "no tenant or project exists on ApprovalRequest",
    });
    await decideApprovalRequest(created.id, {
      decidedBy: "33333333-3333-4333-8333-333333333333",
      approve: true,
      decisionReason: "independent review",
    });

    const requested = listUnifiedAuditEntries().find((entry) => entry.type === "approval.requested");
    const decided = listUnifiedAuditEntries().find((entry) => entry.type === "approval.decided");
    expect(requested).toBeDefined();
    expect(decided).toBeDefined();
    expect(requested?.tenantId == null || requested.tenantId === "").toBe(true);
    expect(requested?.projectId == null || requested.projectId === "").toBe(true);
    expect(decided?.tenantId == null || decided.tenantId === "").toBe(true);
    expect(decided?.projectId == null || decided.projectId === "").toBe(true);
    expect(verifyAuditLogChain().ok).toBe(true);
  });
});
