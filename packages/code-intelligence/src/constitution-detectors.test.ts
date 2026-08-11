import { describe, expect, it } from "vitest";
import {
  detectApiErrors,
  detectApiPagination,
  detectCfgEnvValidation,
  detectCfgSecretManager,
  detectDeployHealth,
  detectDeployRollback,
  detectObsCorrelationIds,
  detectObsTracing,
  detectRelCircuitBreaker,
  detectRelGracefulShutdown,
  detectRelTimeoutRetry,
  detectTestCriticalPath,
} from "./constitution-detectors.js";
import { checklistById, CONSTITUTION_CHECKLIST } from "./constitution-checklist.js";

const hasFrom = (blob: string) => (re: RegExp) => re.test(blob);
const fileHasFrom = (names: string) => (re: RegExp) =>
  names.split("\n").some((f) => re.test(f));

describe("constitution depth detectors", () => {
  const depthIds = [
    "api.pagination",
    "obs.correlation_ids",
    "deploy.rollback",
    "test.critical_path",
    "rel.circuit_breaker",
    "obs.tracing",
    "rel.graceful_shutdown",
    "cfg.env_validation",
  ] as const;

  it("registers depth checklist items with detectorKeys", () => {
    for (const id of depthIds) {
      const item = checklistById(id);
      expect(item, id).toBeDefined();
      expect(item!.detectorKey.length).toBeGreaterThan(0);
    }
    expect(CONSTITUTION_CHECKLIST.length).toBeGreaterThanOrEqual(57);
  });

  it("detectRelTimeoutRetry requires ≥2 reliability signals for PASS", () => {
    expect(detectRelTimeoutRetry(hasFrom("const x = 1")).status).toBe("WARN");
    expect(
      detectRelTimeoutRetry(hasFrom("fetch with timeout only")).status,
    ).toBe("WARN");
    expect(
      detectRelTimeoutRetry(
        hasFrom("AbortSignal.timeout(5000); maxRetries = 3; backoff"),
      ).status,
    ).toBe("PASS");
  });

  it("detectApiPagination finds cursor/limit patterns", () => {
    expect(detectApiPagination(hasFrom("return items")).status).toBe("WARN");
    expect(
      detectApiPagination(hasFrom("const cursor = body.cursor; pageSize = 20")).status,
    ).toBe("PASS");
  });

  it("detectObsCorrelationIds finds request/trace ids", () => {
    expect(detectObsCorrelationIds(hasFrom("console.log(msg)")).status).toBe(
      "WARN",
    );
    expect(
      detectObsCorrelationIds(
        hasFrom('headers["x-request-id"] = requestId; correlationId'),
      ).status,
    ).toBe("PASS");
  });

  it("detectDeployRollback finds rollback/canary signals", () => {
    const empty = fileHasFrom("apps/api/src/index.ts");
    expect(detectDeployRollback(hasFrom("deploy"), empty).status).toBe("WARN");
    expect(
      detectDeployRollback(hasFrom("helm rollback release; canary"), empty)
        .status,
    ).toBe("PASS");
  });

  it("detectTestCriticalPath prefers named auth/payment tests", () => {
    const noTests = fileHasFrom("src/app.ts");
    expect(detectTestCriticalPath(hasFrom(""), noTests).status).toBe("FAIL");
    expect(
      detectTestCriticalPath(
        hasFrom(""),
        fileHasFrom("src/foo.test.ts"),
      ).status,
    ).toBe("WARN");
    expect(
      detectTestCriticalPath(
        hasFrom(""),
        fileHasFrom("src/auth.critical.test.ts"),
      ).status,
    ).toBe("PASS");
  });

  it("detectRelCircuitBreaker / graceful shutdown / tracing / env validation", () => {
    const fh = fileHasFrom("src/otel.ts");
    expect(detectRelCircuitBreaker(hasFrom("fetch(url)")).status).toBe("WARN");
    expect(
      detectRelCircuitBreaker(hasFrom("new CircuitBreaker(fn)")).status,
    ).toBe("PASS");
    expect(detectRelGracefulShutdown(hasFrom("listen(3000)")).status).toBe(
      "WARN",
    );
    expect(
      detectRelGracefulShutdown(hasFrom("process.on('SIGTERM', shutdown)")).status,
    ).toBe("PASS");
    expect(detectObsTracing(hasFrom("log.info"), fileHasFrom("a.ts")).status).toBe(
      "WARN",
    );
    expect(detectObsTracing(hasFrom("@opentelemetry/api"), fh).status).toBe(
      "PASS",
    );
    expect(detectCfgEnvValidation(hasFrom("process.env.FOO")).status).toBe(
      "WARN",
    );
    expect(detectCfgEnvValidation(hasFrom("createEnv({ server: {} })")).status).toBe(
      "PASS",
    );
  });

  it("deepened api_errors / deploy_health / secret_manager stay evidence-based", () => {
    expect(detectApiErrors(hasFrom("throw new Error('x')")).status).toBe("WARN");
    expect(
      detectApiErrors(hasFrom('throw new AtlasError("X", "msg"); error: { code')).status,
    ).toBe("PASS");
    expect(
      detectDeployHealth(hasFrom("app.get('/health')"), fileHasFrom("a.ts")).status,
    ).toBe("PASS");
    expect(
      detectCfgSecretManager(hasFrom("AWS Secrets Manager + Key Vault")).status,
    ).toBe("PASS");
  });
});
