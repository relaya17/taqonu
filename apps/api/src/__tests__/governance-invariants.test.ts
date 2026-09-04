import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAuditLogLine,
  setAuditLogPathForTests,
  verifyAuditChain,
  verifyAuditLogChain,
} from "../services/audit-log.js";
import {
  composeLoopVerdict,
  evaluateWorldState,
  captureExpectedState,
  verificationVerdictFromOutcome,
} from "../services/verification.js";
import { checkResourceAccess } from "../services/resource-access.js";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("governance invariants (stability)", () => {
  it("customer admin is not an Atlas operator", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "admin",
      requiredCapability: "operator",
      resourceOwnerId: ACTOR,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("missing capability is DENY even on an owned resource", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "admin",
      resourceOwnerId: ACTOR,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("wrong tenant is DENY", () => {
    const result = checkResourceAccess({
      actorId: ACTOR,
      role: "user",
      requiredCapability: "write.contract",
      resourceOwnerId: OTHER,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("world-state execution is not verification", () => {
    const expected = captureExpectedState({
      artifactHash: "abc",
      toolName: "knowledge_search",
    });
    const result = evaluateWorldState({
      intended: true,
      authorized: true,
      expected,
      actual: {
        artifactHash: "abc",
        toolName: "knowledge_search",
        executed: true,
        output: "ran",
      },
    });
    expect(result.stageReached).toBe("EXECUTED");
    expect(result.loopVerdict).not.toBe("VERIFIED");
  });

  it("executed is not verified", () => {
    expect(
      verificationVerdictFromOutcome({
        stage: "EXECUTION",
        status: "EXECUTED",
        artifactHash: "00",
        output: "ok",
      }),
    ).toBe("INCONCLUSIVE");
  });

  it("regression FAILED is not verified", () => {
    expect(composeLoopVerdict("VERIFIED", "FAILED")).toBe("FAILED");
  });
});

describe("canonical audit integrity", () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-invariants-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "audit.ndjson");
    setAuditLogPathForTests(logFile);
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("missing or empty log is INCOMPLETE, not VALID", () => {
    expect(verifyAuditLogChain().status).toBe("INCOMPLETE");
    expect(verifyAuditChain().intact).toBe(false);
    writeFileSync(logFile, "", "utf8");
    expect(verifyAuditLogChain().status).toBe("INCOMPLETE");
  });

  it("detects a tampered historical line as BROKEN", () => {
    appendAuditLogLine({ type: "agent.run.completed", runId: "r1" });
    appendAuditLogLine({ type: "agents.plan", planId: "p1" });
    expect(verifyAuditLogChain().status).toBe("VALID");
    const lines = readFileSync(logFile, "utf8").split("\n").filter((l) => l.trim());
    const first = JSON.parse(lines[0] ?? "{}") as { hash?: string };
    first.hash = "0".repeat(64);
    lines[0] = JSON.stringify(first);
    writeFileSync(logFile, `${lines.join("\n")}\n`, "utf8");
    expect(verifyAuditLogChain().status).toBe("BROKEN");
    expect(verifyAuditChain().intact).toBe(false);
  });

  it("a copied NDJSON file still verifies (restore check, not a backup product)", () => {
    appendAuditLogLine({ type: "agent.run.completed", runId: "r1" });
    appendAuditLogLine({ type: "agents.plan", planId: "p1" });
    const copy = join(dir, "restore.ndjson");
    copyFileSync(logFile, copy);
    setAuditLogPathForTests(copy);
    expect(verifyAuditLogChain()).toMatchObject({ ok: true, status: "VALID" });
  });
});
