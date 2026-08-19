import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAuditLogPathForTests, listUnifiedAuditEntries } from "./audit-log.js";

const authorizeEntityActionMock = vi.fn();
vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityActionMock(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { enforceEntityWrite } = await import("./risk-audit.js");

const ACTOR = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";

describe("enforceEntityWrite", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-risk-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    authorizeEntityActionMock.mockReset();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("no regression: a real ALLOWED decision (real Policy Engine, no mock override) proceeds and logs SUCCESS with a real actorId", () => {
    const result = enforceEntityWrite({
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.record.create",
      actorId: ACTOR,
      projectId: PROJECT,
    });
    // RECORD.CREATE -> LOW_RISK_WRITE base tier (25). This helper doesn't
    // (yet) thread per-call confidence/evidenceCount signals through from
    // routes, so risk-score.ts applies its conservative defaults: +10
    // (confidence defaulted to 0.5) +15 (evidenceCount defaulted to 0) =
    // score 50 -> APPROVAL bucket (50-79), HIGH risk level. This is the
    // formula's intended behavior (unknown confidence/evidence is treated
    // as "assume less safety", never less scrutiny) — not a bug in either
    // the engine or this helper. It does NOT block execution: the entity
    // policy already decided ALLOWED (self-approved-write pattern), and
    // this bucket is audit-trail annotation only.
    expect(result.bucket).toBe("APPROVAL");
    expect(result.riskLevel).toBe("HIGH");
    expect(result.score).toBe(50);

    const [entry] = listUnifiedAuditEntries();
    expect(entry?.actorId).toBe(ACTOR);
    expect(entry?.ownerId).toBe(ACTOR);
    expect(entry?.projectId).toBe(PROJECT);
    expect(entry?.result).toBe("SUCCESS");
    expect(entry?.policy).toBe("RECORD.CREATE");
    expect(entry?.risk).toBe("HIGH");
    expect(entry?.approval).toBe("NOT_REQUIRED");
  });

  it("a higher-risk entity/action (DESTRUCTIVE + requiresApproval) lands in a stricter bucket and logs APPROVED", () => {
    const result = enforceEntityWrite({
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.record.delete",
      actorId: ACTOR,
      projectId: PROJECT,
    });
    // RECORD.DELETE -> DESTRUCTIVE base tier (75), requiresApproval floor
    // doesn't lower it -> APPROVAL or HUMAN_ONLY bucket (never AUTO/AUTO_LOG).
    expect(["APPROVAL", "HUMAN_ONLY"]).toContain(result.bucket);
    expect(["HIGH", "CRITICAL"]).toContain(result.riskLevel);

    const [entry] = listUnifiedAuditEntries();
    expect(entry?.approval).toBe("APPROVED");
    expect(entry?.result).toBe("SUCCESS");
  });

  it("throws FORBIDDEN and logs a REJECTED/FAILURE entry on a DENIED decision, without fabricating an actorId", async () => {
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    expect(() =>
      enforceEntityWrite({
        entityType: "CONFIGURATION",
        action: "UPDATE",
        routeLabel: "test.config.update",
        actorId: ACTOR,
        projectId: null,
      }),
    ).toThrow(/test-forced denial/);

    const [entry] = listUnifiedAuditEntries();
    expect(entry?.actorId).toBe(ACTOR);
    expect(entry?.result).toBe("FAILURE");
    expect(entry?.approval).toBe("REJECTED");
    expect(entry?.risk).toBe("CRITICAL");
    expect(entry?.reason).toBe("test-forced denial");
  });

  it("thrown AtlasError carries statusCode 403 (drop-in contract for existing enforce<X>EntityAuthz call sites)", async () => {
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "denied",
    });
    const { AtlasError } = await import("@atlas/shared");
    try {
      enforceEntityWrite({
        entityType: "RECORD",
        action: "UPDATE",
        routeLabel: "test.record.update",
        actorId: ACTOR,
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AtlasError);
      expect((error as InstanceType<typeof AtlasError>).statusCode).toBe(403);
    }
  });

  it("omitting projectId records a null projectId rather than fabricating one", () => {
    enforceEntityWrite({
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.record.create.no-project",
      actorId: ACTOR,
    });
    const [entry] = listUnifiedAuditEntries();
    expect(entry?.projectId ?? null).toBeNull();
  });
});
