import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { cpus, freemem, totalmem } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPLICATION_EXECUTION_REPORT_SCHEMA,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationConnectorSigningString,
} from "@atlas/shared";
import {
  readApplicationConnectorHmacHeaders,
  verifyApplicationConnectorSignature,
} from "./application-connector-hmac.js";
import {
  collectAsyncSamples,
  collectSyncSamples,
  summarizeTimings,
  type TimingSummary,
} from "./control-performance-measure.js";

const WARMUP = 5;
const N = 30;
const HANG_GUARD_MS = 120_000;
const SECRET = "civio-connector-test-secret-32b!!";
const TENANT = "tenant-a";
const PROJECT = "project-a";

const tmpRoot = mkdtempSync(join(tmpdir(), "atlas-r13-"));
process.env.ATLAS_STORE_PATH = join(tmpRoot, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const { evaluateApplicationPreflight, resetApplicationPreflightForTests } =
  await import("./application-preflight.js");
const {
  evaluateApplicationExecutionReport,
  resetApplicationExecutionReportForTests,
} = await import("./application-execution-report.js");
const {
  appendUnifiedAuditEntry,
  listUnifiedAuditEntries,
  lookupIndexedFailureCitation,
  setAuditLogPathForTests,
} = await import("./audit-log.js");

function sign(rawBody: string): Record<string, string> {
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", SECRET)
    .update(applicationConnectorSigningString(timestamp, nonce, rawBody), "utf8")
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-atlas-connector-timestamp": timestamp,
    "x-atlas-connector-nonce": nonce,
    "x-atlas-connector-signature": signature,
  };
}

function preflightBody(): string {
  return JSON.stringify({
    schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
    applicationId: "civio",
    tenantId: TENANT,
    projectId: PROJECT,
    actorId: "civio-runtime",
    actorKind: "USER",
    operation: "civio.legal.query",
    operationClass: "GOVERNED_DECISION",
    requestId: `req-${randomBytes(8).toString("hex")}`,
    idempotencyKey: `idem-${randomBytes(8).toString("hex")}`,
  });
}

function reportBody(decisionId: string, requestId: string, executionId: string): string {
  return JSON.stringify({
    schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
    applicationId: "civio",
    tenantId: TENANT,
    projectId: PROJECT,
    decisionId,
    requestId,
    operation: "civio.legal.query",
    executionId,
    executionStatus: "SUCCESS",
  });
}

function unifiedNoise(reason: string): void {
  appendUnifiedAuditEntry({
    type: "patch.applied",
    actorId: "r13",
    actorKind: "USER",
    reason,
    risk: "LOW",
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
  });
}

function writeFailure(decisionId: string, executionId: string): void {
  appendUnifiedAuditEntry({
    type: "application.execution.reported",
    entityType: "application_execution_report",
    action: "civio.legal.query",
    actorId: "civio:connector",
    actorKind: "SYSTEM",
    reason: "Application reported an execution correlated to a preceding ALLOW",
    policy: APPLICATION_EXECUTION_REPORT_SCHEMA,
    risk: "LOW",
    approval: "NOT_REQUIRED",
    decision: "ALLOW",
    input: {
      decisionId,
      requestId: `req-${decisionId}`,
      executionId,
      executionStatus: "FAILURE",
      applicationId: "civio",
      tenantId: TENANT,
      projectId: PROJECT,
      operation: "civio.legal.query",
    },
    output: { accepted: true, executionStatus: "FAILURE" },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  });
}

describe("R13 Control path measurement", () => {
  const originals = {
    secret: process.env.ATLAS_CIVIO_CONNECTOR_SECRET,
    tenant: process.env.ATLAS_CIVIO_TENANT_ID,
    project: process.env.ATLAS_CIVIO_PROJECT_ID,
  };

  beforeEach(() => {
    process.env.ATLAS_CIVIO_CONNECTOR_SECRET = SECRET;
    process.env.ATLAS_CIVIO_TENANT_ID = TENANT;
    process.env.ATLAS_CIVIO_PROJECT_ID = PROJECT;
    delete process.env.ATLAS_KILL_SWITCHES;
    setAuditLogPathForTests(join(tmpRoot, `audit-${randomBytes(8).toString("hex")}.ndjson`));
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
  });

  afterEach(() => {
    resetApplicationPreflightForTests();
    resetApplicationExecutionReportForTests();
    setAuditLogPathForTests(null);
    if (originals.secret === undefined) delete process.env.ATLAS_CIVIO_CONNECTOR_SECRET;
    else process.env.ATLAS_CIVIO_CONNECTOR_SECRET = originals.secret;
    if (originals.tenant === undefined) delete process.env.ATLAS_CIVIO_TENANT_ID;
    else process.env.ATLAS_CIVIO_TENANT_ID = originals.tenant;
    if (originals.project === undefined) delete process.env.ATLAS_CIVIO_PROJECT_ID;
    else process.env.ATLAS_CIVIO_PROJECT_ID = originals.project;
  });

  it("measures existing Control operations and records a local-process distribution", async () => {
    const hmacBody = preflightBody();
    const hmacHeaders = sign(hmacBody);
    const hmac = readApplicationConnectorHmacHeaders(hmacHeaders);

    const hmacSamples = collectSyncSamples({
      warmup: WARMUP,
      n: N,
      run: () => {
        const verified = verifyApplicationConnectorSignature({
          secret: SECRET,
          rawBody: hmacBody,
          timestamp: hmac.timestamp,
          nonce: hmac.nonce,
          signature: hmac.signature,
        });
        if (!verified.ok) throw new Error(verified.reason);
      },
    });

    const preflightSamples = await collectAsyncSamples({
      warmup: WARMUP,
      n: N,
      run: async () => {
        const rawBody = preflightBody();
        const result = await evaluateApplicationPreflight({
          rawBody,
          headers: sign(rawBody),
        });
        if (result.status !== 200) {
          throw new Error(`preflight status ${result.status}`);
        }
      },
    });

    const reportSamples = await collectAsyncSamples({
      warmup: WARMUP,
      n: N,
      run: async () => {
        const rawPreflight = preflightBody();
        const allowed = await evaluateApplicationPreflight({
          rawBody: rawPreflight,
          headers: sign(rawPreflight),
        });
        const body = allowed.body as {
          decisionId: string;
          requestId: string;
        };
        const rawReport = reportBody(
          body.decisionId,
          body.requestId,
          `chatcmpl-${randomBytes(6).toString("hex")}`,
        );
        const reported = await evaluateApplicationExecutionReport({
          rawBody: rawReport,
          headers: sign(rawReport),
        });
        if (reported.status !== 200) {
          throw new Error(`execution-report status ${reported.status}`);
        }
      },
    });

    const auditAppendSamples = collectSyncSamples({
      warmup: WARMUP,
      n: N,
      run: () => {
        unifiedNoise(`r13-append-${randomBytes(4).toString("hex")}`);
      },
    });

    for (let i = 0; i < 80; i += 1) {
      unifiedNoise(`r13-query-seed-${i}`);
    }
    const auditQuerySamples = collectSyncSamples({
      warmup: WARMUP,
      n: N,
      run: () => {
        const listed = listUnifiedAuditEntries();
        if (listed.length < 80) {
          throw new Error("audit query returned fewer rows than seeded");
        }
      },
    });

    writeFailure("dec-r13-1", "exec-r13-1");
    writeFailure("dec-r13-2", "exec-r13-2");
    const citationSamples = collectSyncSamples({
      warmup: WARMUP,
      n: N,
      run: () => {
        const found = lookupIndexedFailureCitation("dec-r13-1", "exec-r13-1");
        if (!found) throw new Error("citation lookup missed seeded FAILURE");
      },
    });

    const summaries: TimingSummary[] = [
      summarizeTimings({
        path: "connector_hmac_verify",
        measurementClass: "unit_test_local_process",
        warmup: WARMUP,
        samplesMs: hmacSamples,
      }),
      summarizeTimings({
        path: "application_preflight_evaluate",
        measurementClass: "unit_test_local_process",
        warmup: WARMUP,
        samplesMs: preflightSamples,
      }),
      summarizeTimings({
        path: "application_execution_report_after_allow",
        measurementClass: "unit_test_local_process",
        warmup: WARMUP,
        samplesMs: reportSamples,
      }),
      summarizeTimings({
        path: "unified_audit_append",
        measurementClass: "unit_test_local_process",
        warmup: WARMUP,
        samplesMs: auditAppendSamples,
      }),
      summarizeTimings({
        path: "unified_audit_query_list",
        measurementClass: "unit_test_local_process",
        warmup: WARMUP,
        samplesMs: auditQuerySamples,
      }),
      summarizeTimings({
        path: "learning_failure_citation_lookup",
        measurementClass: "unit_test_local_process",
        warmup: WARMUP,
        samplesMs: citationSamples,
      }),
    ];

    const environment = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemMb: Math.round(totalmem() / (1024 * 1024)),
      freeMemMb: Math.round(freemem() / (1024 * 1024)),
      governanceStore: "local_maps",
      livePostgres: false,
      production: false,
    };

    const report = {
      id: "R13",
      measurementClass: "unit_test_local_process",
      warmup: WARMUP,
      n: N,
      hangGuardMs: HANG_GUARD_MS,
      environment,
      paths: summaries.map((row) => ({
        path: row.path,
        n: row.n,
        minMs: Number(row.minMs.toFixed(3)),
        maxMs: Number(row.maxMs.toFixed(3)),
        meanMs: Number(row.meanMs.toFixed(3)),
        p50Ms: Number(row.p50Ms.toFixed(3)),
        p95Ms: Number(row.p95Ms.toFixed(3)),
        samplesMs: row.samplesMs.map((ms) => Number(ms.toFixed(3))),
      })),
    };
    console.log(`R13_CONTROL_MEASUREMENT=${JSON.stringify(report)}`);

    for (const row of summaries) {
      expect(row.n).toBe(N);
      expect(row.samplesMs).toHaveLength(N);
      expect(row.maxMs).toBeLessThan(HANG_GUARD_MS);
      expect(Number.isFinite(row.p95Ms)).toBe(true);
    }
    expect(report.environment.livePostgres).toBe(false);
    expect(report.environment.production).toBe(false);

    rmSync(tmpRoot, { recursive: true, force: true });
  }, 120_000);
});
