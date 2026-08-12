import { describe, expect, it } from "vitest";
import { constitutionDomainSchema } from "@atlas/shared";
import {
  CONSTITUTION_DETECTOR_KEYS,
  detectApiErrors,
  detectApiPagination,
  detectCfgEnvValidation,
  detectCfgSecretManager,
  detectDbIndexesBackup,
  detectDeployHealth,
  detectDeployRollback,
  detectDepsLicenseAudit,
  detectExtApiFailureModes,
  detectFooterContactCopyright,
  detectHygConsoleTodo,
  detectI18nLocaleRoutes,
  detectLegalRetentionDeletion,
  detectNavBreadcrumbs,
  detectObsCorrelationIds,
  detectObsTracing,
  detectPerfCaching,
  detectRelCircuitBreaker,
  detectRelGracefulShutdown,
  detectRelTimeoutRetry,
  detectRespViewportOverflow,
  detectTestCriticalPath,
  detectUiSharedPrimitives,
  detectUxErrorConfirm,
} from "./constitution-detectors.js";
import { checklistById, CONSTITUTION_CHECKLIST } from "./constitution-checklist.js";

const hasFrom = (blob: string) => (re: RegExp) => re.test(blob);
const fileHasFrom = (names: string) => (re: RegExp) =>
  names.split("\n").some((f) => re.test(f));

const ALL_DOMAINS = constitutionDomainSchema.options;

describe("constitution 23-domain coverage", () => {
  it("schema enumerates exactly 23 domains", () => {
    expect(ALL_DOMAINS).toHaveLength(23);
  });

  it("checklist catalog spans all 23 domains with ≥1 item each", () => {
    const covered = new Set(CONSTITUTION_CHECKLIST.map((c) => c.domain));
    for (const domain of ALL_DOMAINS) {
      expect(covered.has(domain), `missing domain ${domain}`).toBe(true);
    }
    expect(covered.size).toBe(23);
  });

  it("every checklist detectorKey is registered as implemented", () => {
    const implemented = new Set<string>(CONSTITUTION_DETECTOR_KEYS);
    for (const item of CONSTITUTION_CHECKLIST) {
      expect(
        implemented.has(item.detectorKey),
        `unwired detectorKey ${item.detectorKey} (${item.id})`,
      ).toBe(true);
    }
    expect(CONSTITUTION_CHECKLIST.length).toBeGreaterThanOrEqual(69);
  });
});

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

  const coverageIds = [
    "nav.breadcrumbs",
    "footer.contact_copyright",
    "resp.viewport_overflow",
    "ui.shared_primitives",
    "ux.error_confirm",
    "perf.caching",
    "db.indexes_backup",
    "ext.api_failure_modes",
    "deps.license_audit",
    "hyg.console_todo",
    "i18n.locale_routes",
    "legal.retention_deletion",
  ] as const;

  it("registers depth checklist items with detectorKeys", () => {
    for (const id of depthIds) {
      const item = checklistById(id);
      expect(item, id).toBeDefined();
      expect(item!.detectorKey.length).toBeGreaterThan(0);
    }
  });

  it("registers 23-domain coverage MVP checklist items", () => {
    for (const id of coverageIds) {
      const item = checklistById(id);
      expect(item, id).toBeDefined();
      expect(item!.detectorKey.length).toBeGreaterThan(0);
    }
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

  it("coverage detectors: footer/responsive/ui/ux/perf", () => {
    expect(detectFooterContactCopyright(hasFrom("nav only")).status).toBe("WARN");
    expect(
      detectFooterContactCopyright(hasFrom("© 2026 Atlas · contact@atlas.dev")).status,
    ).toBe("PASS");
    expect(detectRespViewportOverflow(hasFrom("div")).status).toBe("WARN");
    expect(
      detectRespViewportOverflow(hasFrom('meta name="viewport"; overflow-x: hidden')).status,
    ).toBe("PASS");
    expect(
      detectUiSharedPrimitives(hasFrom(""), fileHasFrom("src/page.tsx")).status,
    ).toBe("WARN");
    expect(
      detectUiSharedPrimitives(
        hasFrom("import { Button } from '@/components/ui/button'"),
        fileHasFrom("components/ui/button.tsx"),
      ).status,
    ).toBe("PASS");
    expect(detectUxErrorConfirm(hasFrom("save()")).status).toBe("WARN");
    expect(
      detectUxErrorConfirm(hasFrom("toast.error(e); ConfirmDialog destructive")).status,
    ).toBe("PASS");
    expect(detectPerfCaching(hasFrom("fetch")).status).toBe("WARN");
    expect(
      detectPerfCaching(hasFrom("Cache-Control: s-maxage=60; revalidate = 30")).status,
    ).toBe("PASS");
  });

  it("coverage detectors: db/ext/deps/hyg/i18n/legal/nav", () => {
    const empty = fileHasFrom("src/a.ts");
    expect(detectDbIndexesBackup(hasFrom("select *"), empty).status).toBe("WARN");
    expect(
      detectDbIndexesBackup(
        hasFrom("CREATE INDEX + pg_dump backup restore"),
        empty,
      ).status,
    ).toBe("PASS");
    expect(detectExtApiFailureModes(hasFrom("local only")).status).toBe(
      "UNKNOWN",
    );
    expect(
      detectExtApiFailureModes(hasFrom("stripe.charges.create(); AbortSignal.timeout")).status,
    ).toBe("PASS");
    expect(detectDepsLicenseAudit(hasFrom("deps"), empty).status).toBe("WARN");
    expect(
      detectDepsLicenseAudit(hasFrom("pnpm audit"), fileHasFrom("LICENSE")).status,
    ).toBe("PASS");
    expect(detectHygConsoleTodo(hasFrom("const x = 1")).status).toBe("PASS");
    expect(
      detectHygConsoleTodo(hasFrom("console.log(x); // TODO fix")).status,
    ).toBe("WARN");
    expect(
      detectI18nLocaleRoutes(
        hasFrom("LanguageSelect setLanguage"),
        fileHasFrom("src/app.tsx"),
      ).status,
    ).toBe("FAIL");
    expect(
      detectI18nLocaleRoutes(
        hasFrom("useTranslations"),
        fileHasFrom("app/[locale]/page.tsx\nmessages/he.json"),
      ).status,
    ).toBe("PASS");
    expect(detectLegalRetentionDeletion(hasFrom("terms"), empty).status).toBe(
      "WARN",
    );
    expect(
      detectLegalRetentionDeletion(
        hasFrom("GDPR data retention + delete account"),
        empty,
      ).status,
    ).toBe("PASS");
    expect(detectNavBreadcrumbs(hasFrom("Navbar")).status).toBe("WARN");
    expect(detectNavBreadcrumbs(hasFrom("<Breadcrumbs />")).status).toBe("PASS");
  });
});
