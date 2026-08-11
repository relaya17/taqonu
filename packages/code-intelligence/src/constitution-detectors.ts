/**
 * Evidence-based Constitution detector helpers (ADR-020).
 * Pure blob/name checks — no vanity scores; PASS only when signals exist.
 */

export type DetectorEval = {
  status: "PASS" | "FAIL" | "WARN" | "UNKNOWN";
  evidenceRefs: string[];
  notes: string;
};

type HasFn = (re: RegExp) => boolean;
type FileHasFn = (re: RegExp) => boolean;

/** Timeout + retry + abort/circuit — PASS when ≥2 distinct reliability signals. */
export function detectRelTimeoutRetry(has: HasFn): DetectorEval {
  const hasTimeout = has(/\btimeouts?\b|AbortSignal\.timeout|signal:\s*AbortSignal|connectTimeout|requestTimeout/i);
  const hasRetry = has(/\bretr(?:y|ies)\b|backoff|exponentialBackoff|maxRetries|retryPolicy/i);
  const hasAbortOrCircuit = has(/AbortSignal|AbortController|circuitBreaker|circuit.?breaker|bulkhead/i);
  const hits = [hasTimeout, hasRetry, hasAbortOrCircuit].filter(Boolean).length;
  if (hits >= 2) {
    return {
      status: "PASS",
      evidenceRefs: ["reliability", `signals=${hits}`],
      notes: "Timeout/retry/abort patterns present",
    };
  }
  if (hits === 1) {
    return {
      status: "WARN",
      evidenceRefs: ["reliability", `signals=${hits}`],
      notes: "Only one of timeout/retry/abort — add bounded retries with timeouts for externals",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["reliability"],
    notes: "Few timeout/retry patterns",
  };
}

/** Secret manager / platform secrets — broader than plain .env. */
export function detectCfgSecretManager(has: HasFn): DetectorEval {
  return has(
    /Secret Manager|secretsmanager|Key Vault|AzureKeyVault|AWS_SECRETS|Secrets Manager|doppler|infisical|vault\.|hashicorp.?vault|vercel.*env|platform secrets|SSM_PARAMETER|Parameter Store|github.?secrets|OP_SERVICE_ACCOUNT|1password/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["secrets-mgr"],
        notes: "Secret manager / platform secrets signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["secrets-mgr"],
        notes: "Only local env patterns — document prod secret manager",
      };
}

/** Health / readiness / liveness — code routes + probe configs. */
export function detectDeployHealth(has: HasFn, fileHas: FileHasFn): DetectorEval {
  const route = has(/\/health|readiness|liveness|healthcheck|healthz|readyz/i);
  const probe = has(/readinessProbe|livenessProbe|startupProbe|healthcheck:/i);
  if (route || probe || fileHas(/health\.(ts|js|tsx)$/i)) {
    return {
      status: "PASS",
      evidenceRefs: ["health"],
      notes: route && probe
        ? "Health route + probe config signal"
        : "Health endpoint / probe signal",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["health"],
    notes: "No health check signal",
  };
}

/** Structured API errors with codes — deepen beyond reply.status alone. */
export function detectApiErrors(has: HasFn): DetectorEval {
  const shaped = has(/error:\s*\{\s*code|ERROR_[A-Z_]+|AtlasError|HttpError|problem\+json|application\/problem/i);
  const statusOnly = has(/reply\.status\(|res\.status\(|throw new Error/i);
  if (shaped) {
    return {
      status: "PASS",
      evidenceRefs: ["api-errors"],
      notes: "Structured error code/envelope patterns",
    };
  }
  if (statusOnly) {
    return {
      status: "WARN",
      evidenceRefs: ["api-errors"],
      notes: "Status codes without clear { error: { code } } envelope",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["api-errors"],
    notes: "Unclear API error contract",
  };
}

/** Cursor/page/limit pagination for list APIs. */
export function detectApiPagination(has: HasFn): DetectorEval {
  return has(
    /\bcursor\b|\bpageSize\b|\bpage_size\b|\blimit\b.*\boffset\b|\boffset\b.*\blimit\b|nextPageToken|continuationToken|Link:\s*<[^>]+>;\s*rel="next"|pagination/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["api-pagination"],
        notes: "Pagination signals (cursor/page/limit)",
      }
    : {
        status: "WARN",
        evidenceRefs: ["api-pagination"],
        notes: "No pagination signal for list endpoints",
      };
}

/** Request / correlation / trace IDs for log joining. */
export function detectObsCorrelationIds(has: HasFn): DetectorEval {
  return has(
    /correlationId|correlation.?id|requestId|request.?id|x-request-id|x-correlation-id|traceparent|traceId|trace.?id|req\.id\b/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["obs-correlation"],
        notes: "Correlation/request/trace ID signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["obs-correlation"],
        notes: "No correlation/request ID signal for log joining",
      };
}

/** Rollback / blue-green / canary deploy hints. */
export function detectDeployRollback(has: HasFn, fileHas: FileHasFn): DetectorEval {
  const signals = has(
    /\brollback\b|blue.?green|canary|traffic.?shift|previous.?revision|helm rollback|kubectl.?rollout|deployment.?revision|release.?rollback/i,
  );
  const docs = fileHas(/runbook|rollback|RELEASE/i);
  if (signals || docs) {
    return {
      status: "PASS",
      evidenceRefs: ["deploy-rollback"],
      notes: "Rollback / progressive-delivery signal",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["deploy-rollback"],
    notes: "No rollback/canary/blue-green signal",
  };
}

/** Tests that name critical paths (auth, payment, webhook, etc.). */
export function detectTestCriticalPath(has: HasFn, fileHas: FileHasFn): DetectorEval {
  const named = fileHas(
    /(auth|payment|checkout|webhook|billing|login|signup|critical).*\.(test|spec)\./i,
  ) || has(/describe\(['"`].*(auth|payment|checkout|webhook|critical.?path)/i);
  if (named) {
    return {
      status: "PASS",
      evidenceRefs: ["test-critical"],
      notes: "Critical-path test naming signal",
    };
  }
  if (fileHas(/\.(test|spec)\.|e2e\//)) {
    return {
      status: "WARN",
      evidenceRefs: ["test-critical"],
      notes: "Tests exist but no auth/payment/webhook critical-path naming",
    };
  }
  return {
    status: "FAIL",
    evidenceRefs: ["test-critical"],
    notes: "No critical-path tests detected",
  };
}

/** Circuit breaker / bulkhead for external calls. */
export function detectRelCircuitBreaker(has: HasFn): DetectorEval {
  return has(/circuitBreaker|circuit.?breaker|opossum|bulkhead|cockatiel|resilience4j|half.?open/i)
    ? {
        status: "PASS",
        evidenceRefs: ["circuit-breaker"],
        notes: "Circuit breaker / bulkhead signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["circuit-breaker"],
        notes: "No circuit-breaker/bulkhead signal for externals",
      };
}

/** Distributed tracing / OpenTelemetry. */
export function detectObsTracing(has: HasFn, fileHas: FileHasFn): DetectorEval {
  return has(/opentelemetry|@opentelemetry|otel\.|startSpan|trace\.getTracer|dd-trace|jaeger|zipkin/i) ||
    fileHas(/otel|opentelemetry|tracing/i)
    ? {
        status: "PASS",
        evidenceRefs: ["obs-tracing"],
        notes: "Tracing / OpenTelemetry signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["obs-tracing"],
        notes: "No distributed tracing signal",
      };
}

/** Graceful shutdown / drain on SIGTERM. */
export function detectRelGracefulShutdown(has: HasFn): DetectorEval {
  return has(/SIGTERM|SIGINT|graceful.?shutdown|server\.close|beforeExit|shutdown.?hook|on\(['"]SIGTERM/i)
    ? {
        status: "PASS",
        evidenceRefs: ["graceful-shutdown"],
        notes: "Graceful shutdown / SIGTERM signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["graceful-shutdown"],
        notes: "No graceful shutdown / SIGTERM drain signal",
      };
}

/** Env schema validation (zod/envsafe/t3-env). */
export function detectCfgEnvValidation(has: HasFn): DetectorEval {
  return has(
    /envSchema|createEnv|t3-env|@t3-oss\/env|envsafe|zod.*process\.env|process\.env.*safeParse|atlasEnv|loadEnv/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["env-validation"],
        notes: "Env schema / validated config signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["env-validation"],
        notes: "No env schema validation signal",
      };
}
