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

/** Footer contact / copyright — only meaningful for public-facing products. */
export function detectFooterContactCopyright(has: HasFn): DetectorEval {
  return has(
    /copyright|©|\ball rights reserved\b|contact@|mailto:|footer.*(contact|about|help)|ContactUs|support@/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["footer-contact"],
        notes: "Footer contact/copyright signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["footer-contact"],
        notes: "No footer contact/copyright signal for public profile",
      };
}

/** SARIF / Semgrep / CodeQL scanner wired into CI or security feed. */
export function detectSecScannerSarif(has: HasFn, fileHas: FileHasFn): DetectorEval {
  const ci =
    has(/sarif|semgrep|codeql|trivy|gitleaks|snyk|npm audit|pnpm audit/i) ||
    fileHas(/\.sarif$|semgrep|codeql|trivy|gitleaks/i);
  if (ci) {
    return {
      status: "PASS",
      evidenceRefs: ["sec-scanner"],
      notes: "Scanner / SARIF / audit signal in CI or repo",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["sec-scanner"],
    notes: "No Semgrep/CodeQL/SARIF/audit scanner signal",
  };
}

/** Metrics export — Prometheus, OpenMetrics, or /metrics route. */
export function detectObsMetricsExport(has: HasFn): DetectorEval {
  return has(
    /\/metrics|prometheus|OpenMetrics|toPrometheusText|InMemoryMetrics|statsd|datadog\.metrics/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["obs-metrics"],
        notes: "Metrics / Prometheus export signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["obs-metrics"],
        notes: "No /metrics or Prometheus export signal",
      };
}

/** Deploy provider feed (Vercel/Render/Netlify observe → evidence). */
export function detectDeployProviderFeed(has: HasFn): DetectorEval {
  return has(
    /vercel\/observe|render\/observe|netlify|vercelObservation|renderObservation|DEPLOYMENT.*evidence|provider.*vercel|provider.*render/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["deploy-feed"],
        notes: "Deploy provider observe→evidence feed signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["deploy-feed"],
        notes: "No Vercel/Render deploy→evidence feed signal",
      };
}

/** Rate limit / throttle — broader than single token. */
export function detectSecRateLimit(has: HasFn): DetectorEval {
  return has(
    /rateLimit|rate-limit|ratelimit|throttle|@fastify\/rate-limit|express-rate-limit|bottleneck|token.?bucket|leaky.?bucket/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["rate-limit"],
        notes: "Rate limit / throttle signal",
      }
    : {
        status: "FAIL",
        evidenceRefs: ["rate-limit"],
        notes: "No rate limiting signal",
      };
}

/** Viewport meta / overflow guards for responsive layouts. */
export function detectRespViewportOverflow(has: HasFn): DetectorEval {
  return has(
    /viewport|overflow-x|overflowX|max-w-|maxWidth|container-fluid|clamp\(|dvh|svh|safe-area/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["resp-overflow"],
        notes: "Viewport / overflow / fluid-width signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["resp-overflow"],
        notes: "No viewport/overflow responsive guard signal",
      };
}

/** Shared UI primitives / component library (not one-off controls). */
export function detectUiSharedPrimitives(has: HasFn, fileHas: FileHasFn): DetectorEval {
  const pkg = fileHas(/components\/ui\/|packages\/ui|design-system|ui-kit/i);
  const usage = has(
    /from ['\"]@\/components\/ui|from ['\"]@atlas\/ui|Button\s*from|TextField|MuiButton|shared.*(Button|Input)/i,
  );
  if (pkg || usage) {
    return {
      status: "PASS",
      evidenceRefs: ["ui-primitives"],
      notes: "Shared UI primitives / component library signal",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["ui-primitives"],
    notes: "No shared Button/Input/component-library signal",
  };
}

/** Error toasts + destructive confirmation patterns. */
export function detectUxErrorConfirm(has: HasFn): DetectorEval {
  const err = has(/toast\.error|Snackbar|Alert\b|errorMessage|ErrorBoundary|onError/i);
  const confirm = has(
    /ConfirmDialog|window\.confirm|destructive|are you sure|confirmDelete|AlertDialog/i,
  );
  if (err && confirm) {
    return {
      status: "PASS",
      evidenceRefs: ["ux-error-confirm"],
      notes: "Error feedback + destructive-confirm signals",
    };
  }
  if (err || confirm) {
    return {
      status: "WARN",
      evidenceRefs: ["ux-error-confirm"],
      notes: "Only one of error-feedback / destructive-confirm — add both",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["ux-error-confirm"],
    notes: "No error toast / destructive confirm patterns",
  };
}

/** Cache-Control / CDN / revalidate signals. */
export function detectPerfCaching(has: HasFn): DetectorEval {
  return has(
    /Cache-Control|cdn\.|cloudflare|revalidate|stale-while-revalidate|s-maxage|unstable_cache|cache:\s*['\"]force-cache/i,
  )
    ? {
        status: "PASS",
        evidenceRefs: ["perf-cache"],
        notes: "Caching / CDN / revalidate signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["perf-cache"],
        notes: "No Cache-Control/CDN/revalidate signal",
      };
}

/** DB indexes and/or backup/restore documentation. */
export function detectDbIndexesBackup(has: HasFn, fileHas: FileHasFn): DetectorEval {
  const indexes = has(
    /\bcreateIndex\b|\.index\(|CREATE INDEX|@@index|addIndex|gin\(|btree/i,
  );
  const backup =
    has(/backup|restore|pg_dump|point.?in.?time|PITR|retention.?policy/i) ||
    fileHas(/backup|restore|runbook/i);
  if (indexes && backup) {
    return {
      status: "PASS",
      evidenceRefs: ["db-index-backup"],
      notes: "Index + backup/restore signals",
    };
  }
  if (indexes || backup) {
    return {
      status: "WARN",
      evidenceRefs: ["db-index-backup"],
      notes: indexes
        ? "Indexes present — document backup/restore"
        : "Backup/restore notes without clear index signals",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["db-index-backup"],
    notes: "No index or backup/restore signal",
  };
}

/** External API failure modes: timeouts, vendor errors, deprecation notes. */
export function detectExtApiFailureModes(has: HasFn): DetectorEval {
  const vendor = has(
    /stripe|openai|github\.com\/|googleapis|twilio|sendgrid|webhook|fetch\(/i,
  );
  if (!vendor) {
    return {
      status: "UNKNOWN",
      evidenceRefs: ["ext-failure"],
      notes: "No clear external API client usage in sample",
    };
  }
  const failure = has(
    /catch\s*\(|onError|timeout|AbortSignal|429|rate.?limit|deprecated|apiVersion|API_VERSION|retry/i,
  );
  if (failure) {
    return {
      status: "PASS",
      evidenceRefs: ["ext-failure"],
      notes: "External call failure/timeout/version handling signal",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["ext-failure"],
    notes: "External APIs without evident timeout/error/deprecation handling",
  };
}

/** Console/TODO hygiene — flag debug logs; never treat empty TODO purge as a win. */
export function detectHygConsoleTodo(has: HasFn): DetectorEval {
  const hasConsole = has(/console\.(log|debug|info|warn)\(/);
  const hasTodo = has(/\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b/);
  if (hasConsole && hasTodo) {
    return {
      status: "WARN",
      evidenceRefs: ["hyg-console-todo"],
      notes: "console.* and TODO/FIXME present — triage, don’t fake-clean",
    };
  }
  if (hasConsole) {
    return {
      status: "WARN",
      evidenceRefs: ["hyg-console-todo"],
      notes: "console.* logging in source — prefer structured logger",
    };
  }
  return {
    status: "PASS",
    evidenceRefs: ["hyg-console-todo"],
    notes: hasTodo
      ? "TODOs present (ok if tracked) — no console.* flood signal"
      : "No console.* / TODO flood signal in sample",
  };
}

/** Locale routes / message wiring — not only a language dropdown. */
export function detectI18nLocaleRoutes(has: HasFn, fileHas: FileHasFn): DetectorEval {
  const routes =
    fileHas(/\[locale\]|messages\/(he|en|ar)\.json|locales\//i) ||
    has(/next-intl|useTranslations|createSharedPathnamesNavigation|localePrefix/i);
  const dropdownOnly =
    has(/LanguageSelect|language.?dropdown|setLanguage/i) && !routes;
  if (routes) {
    return {
      status: "PASS",
      evidenceRefs: ["i18n-routes"],
      notes: "Locale routes / message catalogs wired",
    };
  }
  if (dropdownOnly) {
    return {
      status: "FAIL",
      evidenceRefs: ["i18n-routes"],
      notes: "Language dropdown without locale catalogs/routes",
    };
  }
  return {
    status: "WARN",
    evidenceRefs: ["i18n-routes"],
    notes: "No locale-route / catalog wiring signal",
  };
}

/** Retention / deletion / export privacy controls. */
export function detectLegalRetentionDeletion(has: HasFn, fileHas: FileHasFn): DetectorEval {
  return has(
    /data retention|right to be forgotten|delete.?account|erasure|data export|GDPR|CCPA|retention.?policy|soft.?delete/i,
  ) || fileHas(/privacy|retention|gdpr|data-deletion/i)
    ? {
        status: "PASS",
        evidenceRefs: ["legal-retention"],
        notes: "Retention/deletion/export privacy signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["legal-retention"],
        notes: "No retention/deletion/export signal for public product",
      };
}

/** Breadcrumbs / secondary wayfinding beyond primary nav. */
export function detectNavBreadcrumbs(has: HasFn): DetectorEval {
  return has(/breadcrumb|Breadcrumbs|aria-label=['\"]breadcrumb/i)
    ? {
        status: "PASS",
        evidenceRefs: ["nav-breadcrumbs"],
        notes: "Breadcrumb wayfinding signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["nav-breadcrumbs"],
        notes: "No breadcrumb / secondary navigation signal",
      };
}

/** Dependency license / audit signals (not “newest = best”). */
export function detectDepsLicenseAudit(has: HasFn, fileHas: FileHasFn): DetectorEval {
  return has(/license|npm audit|pnpm audit|osv-scanner|snyk|dependabot|license-checker/i) ||
    fileHas(/LICENSE|dependabot|renovate|audit/i)
    ? {
        status: "PASS",
        evidenceRefs: ["deps-license"],
        notes: "License / dependency-audit signal",
      }
    : {
        status: "WARN",
        evidenceRefs: ["deps-license"],
        notes: "No license file or dependency-audit signal",
      };
}

/**
 * Keys with dedicated heuristic detectors (runner may also implement admin_* inline).
 * Used by tests to assert 23-domain coverage MVP wiring.
 */
export const CONSTITUTION_DETECTOR_KEYS = [
  "arch_no_frontend_db",
  "arch_structure",
  "arch_shared_types",
  "sec_auth_present",
  "sec_no_hardcoded_secrets",
  "sec_env_example",
  "sec_cors_or_headers",
  "sec_rate_limit",
  "nav_primary",
  "nav_error_states",
  "nav_breadcrumbs",
  "footer_legal",
  "footer_contact_copyright",
  "a11y_signals",
  "a11y_rtl",
  "a11y_keyboard_focus",
  "a11y_reduced_motion",
  "resp_breakpoints",
  "resp_viewport_overflow",
  "ui_theme",
  "ui_shared_primitives",
  "ux_empty_loading",
  "ux_error_confirm",
  "perf_code_split",
  "perf_caching",
  "db_migrations",
  "db_schema",
  "db_indexes_backup",
  "api_validation",
  "api_errors",
  "api_pagination",
  "test_suite",
  "test_e2e_or_api",
  "test_critical_path",
  "deps_lockfile",
  "deps_no_floating",
  "deps_license_audit",
  "cfg_env",
  "cfg_feature_flags",
  "cfg_secret_manager",
  "cfg_env_validation",
  "deploy_ci",
  "deploy_health",
  "deploy_rollback",
  "obs_logging",
  "obs_correlation_ids",
  "obs_tracing",
  "rel_timeout_retry",
  "rel_idempotency",
  "rel_circuit_breaker",
  "rel_graceful_shutdown",
  "ext_webhook_verify",
  "ext_api_failure_modes",
  "docs_readme",
  "docs_adr",
  "hyg_any",
  "hyg_console_todo",
  "i18n_messages",
  "i18n_locale_routes",
  "legal_privacy",
  "legal_retention_deletion",
  "ai_write_gate",
  "ai_evidence",
  "ai_prompt_injection",
  "ai_egress_redaction",
  "admin_necessity",
  "admin_server_authz",
  "admin_overbuild",
  "sec_csrf_xss",
  "sec_tenant_isolation",
  "sec_scanner_sarif",
  "obs_metrics_export",
  "deploy_provider_feed",
] as const;

export type ConstitutionDetectorKey = (typeof CONSTITUTION_DETECTOR_KEYS)[number];
