import type { ConstitutionChecklistItem } from "@atlas/shared";

type Item = Omit<ConstitutionChecklistItem, never>;

function item(
  partial: Item,
): ConstitutionChecklistItem {
  return partial;
}

const W = ["WEB_APP", "SAAS", "MARKETING_SITE"] as const;
const S = ["WEB_APP", "SAAS", "INTERNAL_TOOL"] as const;
const A = ["ALL"] as const;
const P = ["PAYMENTS", "SAAS"] as const;
const AI = ["AI_PRODUCT", "SAAS"] as const;

/** Machine-readable Engineering Constitution checklist (ADR-020). */
export const CONSTITUTION_CHECKLIST: readonly ConstitutionChecklistItem[] = [
  // 1 Architecture
  item({
    id: "arch.boundaries",
    domain: "ARCHITECTURE",
    title: "Layer boundaries respected",
    description: "Frontend must not call Database/Repository directly",
    severityIfMissing: "CRITICAL",
    profiles: [...A],
    detectorKey: "arch_no_frontend_db",
    remediationHint: "Route via API → Service → Repository → Database",
  }),
  item({
    id: "arch.structure",
    domain: "ARCHITECTURE",
    title: "Clear package/folder structure",
    description: "apps/packages or src layers present",
    severityIfMissing: "MEDIUM",
    profiles: [...A],
    detectorKey: "arch_structure",
    remediationHint: "Adopt monorepo or layered src layout",
  }),
  item({
    id: "arch.shared_types",
    domain: "ARCHITECTURE",
    title: "Shared types / contracts",
    description: "Shared schema or types package exists",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "WEB_APP"],
    detectorKey: "arch_shared_types",
    remediationHint: "Introduce shared Zod/OpenAPI contracts",
  }),

  // 2 Security
  item({
    id: "sec.auth",
    domain: "SECURITY",
    title: "Authentication surface present",
    description: "Login/auth routes or providers exist for SaaS",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "INTERNAL_TOOL", "PAYMENTS"],
    detectorKey: "sec_auth_present",
    remediationHint: "Add AuthN with session or OAuth",
  }),
  item({
    id: "sec.secrets",
    domain: "SECURITY",
    title: "No hardcoded secrets in sample",
    description: "Credential-like patterns absent from source",
    severityIfMissing: "CRITICAL",
    profiles: [...A],
    detectorKey: "sec_no_hardcoded_secrets",
    remediationHint: "Rotate; use env/secret manager",
  }),
  item({
    id: "sec.env_example",
    domain: "SECURITY",
    title: ".env.example without live secrets",
    description: "Env template exists for configuration",
    severityIfMissing: "MEDIUM",
    profiles: [...A],
    detectorKey: "sec_env_example",
    remediationHint: "Add .env.example with placeholders only",
  }),
  item({
    id: "sec.cors",
    domain: "SECURITY",
    title: "CORS / security headers considered",
    description: "CORS or security header config present for APIs",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "WEB_APP"],
    detectorKey: "sec_cors_or_headers",
    remediationHint: "Configure CORS allowlist + security headers",
  }),
  item({
    id: "sec.rate_limit",
    domain: "SECURITY",
    title: "Rate limiting / abuse protection",
    description: "Rate limit middleware or gateway config",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "PAYMENTS", "AI_PRODUCT"],
    detectorKey: "sec_rate_limit",
    remediationHint: "Add rate limits on public and auth endpoints",
  }),

  // 3 Navigation
  item({
    id: "nav.primary",
    domain: "NAVIGATION",
    title: "Primary navigation exists",
    description: "Navbar/sidebar/AppShell navigation",
    severityIfMissing: "HIGH",
    profiles: [...S],
    detectorKey: "nav_primary",
    remediationHint: "Add consistent primary nav for all main routes",
  }),
  item({
    id: "nav.error_pages",
    domain: "NAVIGATION",
    title: "404 / unauthorized states",
    description: "not-found or unauthorized UI present",
    severityIfMissing: "MEDIUM",
    profiles: [...W, "SAAS", "INTERNAL_TOOL"],
    detectorKey: "nav_error_states",
    remediationHint: "Add 404 and forbidden/unauthorized pages",
  }),

  // 4 Footer
  item({
    id: "footer.legal_links",
    domain: "FOOTER",
    title: "Footer legal links when public product",
    description: "Privacy/Terms links for public SaaS/marketing",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "MARKETING_SITE", "PAYMENTS"],
    detectorKey: "footer_legal",
    remediationHint: "Add Privacy + Terms only if product is public-facing",
  }),

  // 5 Accessibility
  item({
    id: "a11y.semantics",
    domain: "ACCESSIBILITY",
    title: "Semantic landmarks / labels signals",
    description: "aria-*, htmlFor, or MUI a11y patterns in UI",
    severityIfMissing: "HIGH",
    profiles: [...W, "SAAS", "INTERNAL_TOOL"],
    detectorKey: "a11y_signals",
    remediationHint: "Add labels, landmarks, keyboard focus paths",
  }),
  item({
    id: "a11y.rtl",
    domain: "ACCESSIBILITY",
    title: "RTL / locale direction support",
    description: "RTL or locale routing for he/ar products",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "WEB_APP"],
    detectorKey: "a11y_rtl",
    remediationHint: "Support dir=rtl and locale routes",
  }),

  // 6 Responsive
  item({
    id: "resp.breakpoints",
    domain: "RESPONSIVE",
    title: "Responsive breakpoints / media queries",
    description: "sm/md/lg or media queries present",
    severityIfMissing: "MEDIUM",
    profiles: [...W, "SAAS"],
    detectorKey: "resp_breakpoints",
    remediationHint: "Design mobile→desktop breakpoints",
  }),

  // 7 UI consistency
  item({
    id: "ui.design_system",
    domain: "UI_CONSISTENCY",
    title: "Shared UI system / theme",
    description: "Theme provider or design-system package",
    severityIfMissing: "MEDIUM",
    profiles: [...S],
    detectorKey: "ui_theme",
    remediationHint: "Centralize buttons/inputs/theme tokens",
  }),

  // 8 UX
  item({
    id: "ux.empty_loading",
    domain: "UX",
    title: "Empty / loading state patterns",
    description: "Loading or empty-state components",
    severityIfMissing: "MEDIUM",
    profiles: [...S],
    detectorKey: "ux_empty_loading",
    remediationHint: "Add loading + empty states for list screens",
  }),

  // 9 Performance
  item({
    id: "perf.split",
    domain: "PERFORMANCE",
    title: "Code splitting / dynamic import signals",
    description: "dynamic() or lazy import usage",
    severityIfMissing: "LOW",
    profiles: ["WEB_APP", "SAAS", "MARKETING_SITE"],
    detectorKey: "perf_code_split",
    remediationHint: "Lazy-load heavy routes and charts",
  }),

  // 10 Database
  item({
    id: "db.migrations",
    domain: "DATABASE",
    title: "Migrations present when DB used",
    description: "migrations/ or prisma migrate folder",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "PAYMENTS", "INTERNAL_TOOL"],
    detectorKey: "db_migrations",
    remediationHint: "Add versioned migrations + restore notes",
  }),
  item({
    id: "db.schema",
    domain: "DATABASE",
    title: "Schema definition present",
    description: "Prisma/SQL/Drizzle schema files",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "PAYMENTS"],
    detectorKey: "db_schema",
    remediationHint: "Commit canonical schema with constraints",
  }),

  // 11 API
  item({
    id: "api.validation",
    domain: "API",
    title: "Request validation (Zod/schema)",
    description: "Zod parse or schema validation on API",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "PAYMENTS", "AI_PRODUCT"],
    detectorKey: "api_validation",
    remediationHint: "Validate all inputs with shared schemas",
  }),
  item({
    id: "api.errors",
    domain: "API",
    title: "Consistent API error shape",
    description: "Structured error responses",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE"],
    detectorKey: "api_errors",
    remediationHint: "Standardize { error: { code, message } }",
  }),

  // 12 Testing
  item({
    id: "test.suite",
    domain: "TESTING",
    title: "Automated tests exist",
    description: "test/spec files or vitest/playwright config",
    severityIfMissing: "HIGH",
    profiles: [...A],
    detectorKey: "test_suite",
    remediationHint: "Cover critical paths with unit/API/E2E",
  }),
  item({
    id: "test.e2e_or_api",
    domain: "TESTING",
    title: "E2E or API integration tests",
    description: "Playwright or API integration tests",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "WEB_APP", "PAYMENTS"],
    detectorKey: "test_e2e_or_api",
    remediationHint: "Add critical-path E2E or API tests",
  }),

  // 13 Dependencies
  item({
    id: "deps.lockfile",
    domain: "DEPENDENCIES",
    title: "Lockfile committed",
    description: "pnpm-lock / package-lock / yarn.lock",
    severityIfMissing: "HIGH",
    profiles: [...A],
    detectorKey: "deps_lockfile",
    remediationHint: "Commit lockfile; enforce in CI",
  }),
  item({
    id: "deps.no_floating",
    domain: "DEPENDENCIES",
    title: "No * / latest floating ranges",
    description: "Avoid newest-is-best floating versions",
    severityIfMissing: "MEDIUM",
    profiles: [...A],
    detectorKey: "deps_no_floating",
    remediationHint: "Pin semver; review breaking changes",
  }),

  // 14 Configuration
  item({
    id: "cfg.env_separation",
    domain: "CONFIGURATION",
    title: "Env-based configuration",
    description: "process.env / config package usage",
    severityIfMissing: "MEDIUM",
    profiles: [...A],
    detectorKey: "cfg_env",
    remediationHint: "Separate dev/staging/prod config",
  }),

  // 15 Deployment
  item({
    id: "deploy.ci",
    domain: "DEPLOYMENT",
    title: "CI / deploy config present",
    description: "GitHub Actions, Vercel, or similar",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "WEB_APP", "API_SERVICE", "PAYMENTS"],
    detectorKey: "deploy_ci",
    remediationHint: "Add CI build + health check + rollback notes",
  }),
  item({
    id: "deploy.health",
    domain: "DEPLOYMENT",
    title: "Health check endpoint",
    description: "/health or readiness probe",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE"],
    detectorKey: "deploy_health",
    remediationHint: "Expose health/readiness for deploy verification",
  }),

  // 16 Observability
  item({
    id: "obs.logging",
    domain: "OBSERVABILITY",
    title: "Structured logging / observability package",
    description: "Logger, otel, or observability module",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "AI_PRODUCT", "PAYMENTS"],
    detectorKey: "obs_logging",
    remediationHint: "Add structured logs + request IDs",
  }),

  // 17 Reliability
  item({
    id: "rel.timeouts_retries",
    domain: "RELIABILITY",
    title: "Timeout / retry patterns",
    description: "timeout, retry, backoff, or circuit signals",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "PAYMENTS", "AI_PRODUCT"],
    detectorKey: "rel_timeout_retry",
    remediationHint: "Add timeouts and bounded retries for externals",
  }),
  item({
    id: "rel.idempotency",
    domain: "RELIABILITY",
    title: "Idempotency for mutating/payment paths",
    description: "Idempotency keys for webhooks/payments",
    severityIfMissing: "CRITICAL",
    profiles: [...P],
    detectorKey: "rel_idempotency",
    remediationHint: "Idempotent webhook + payment handlers",
  }),

  // 18 External APIs
  item({
    id: "ext.webhook_verify",
    domain: "EXTERNAL_APIS",
    title: "Webhook signature verification",
    description: "Verify signatures when webhooks used",
    severityIfMissing: "CRITICAL",
    profiles: [...P, "SAAS", "AI_PRODUCT"],
    detectorKey: "ext_webhook_verify",
    remediationHint: "Verify vendor webhook signatures before trust",
  }),

  // 19 Documentation
  item({
    id: "docs.readme",
    domain: "DOCUMENTATION",
    title: "README present",
    description: "Root README with setup signal",
    severityIfMissing: "MEDIUM",
    profiles: [...A],
    detectorKey: "docs_readme",
    remediationHint: "Document setup, architecture, deploy briefly",
  }),
  item({
    id: "docs.adr",
    domain: "DOCUMENTATION",
    title: "Architecture decisions recorded",
    description: "docs/adr or ADR folder",
    severityIfMissing: "LOW",
    profiles: ["SAAS", "API_SERVICE", "AI_PRODUCT"],
    detectorKey: "docs_adr",
    remediationHint: "Record key ADRs — high signal only",
  }),

  // 20 Code hygiene
  item({
    id: "hyg.no_any_flood",
    domain: "CODE_HYGIENE",
    title: "TypeScript any not flooded",
    description: "Limited any/as any density",
    severityIfMissing: "MEDIUM",
    profiles: [...A],
    detectorKey: "hyg_any",
    remediationHint: "Replace any with contracts; don’t fake-clean TODOs",
  }),

  // 21 i18n
  item({
    id: "i18n.messages",
    domain: "I18N",
    title: "Message catalogs for locales",
    description: "he/en/ar or i18n message files",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "WEB_APP", "MARKETING_SITE"],
    detectorKey: "i18n_messages",
    remediationHint: "Wire real catalogs — not only a language dropdown",
  }),

  // 22 Legal
  item({
    id: "legal.privacy",
    domain: "LEGAL_PRIVACY",
    title: "Privacy policy surface",
    description: "Privacy page/route for public products",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "MARKETING_SITE", "PAYMENTS"],
    detectorKey: "legal_privacy",
    remediationHint: "Add Privacy + retention/deletion story",
  }),

  // 23 AI Safety
  item({
    id: "ai.tool_gate",
    domain: "AI_SAFETY",
    title: "Tool authorization / write gate",
    description: "Approval-gated WRITE or tool policy",
    severityIfMissing: "CRITICAL",
    profiles: [...AI, "SAAS"],
    detectorKey: "ai_write_gate",
    remediationHint: "Gate high-risk AI actions behind human approval",
  }),
  item({
    id: "ai.evidence",
    domain: "AI_SAFETY",
    title: "Evidence / epistemic requirements",
    description: "INSUFFICIENT_EVIDENCE or evidence schema present",
    severityIfMissing: "HIGH",
    profiles: [...AI],
    detectorKey: "ai_evidence",
    remediationHint: "Require Evidence before high-confidence answers",
  }),

  // Admin necessity — product intelligence (not “always scaffold /admin”)
  item({
    id: "sec.admin_necessity",
    domain: "SECURITY",
    title: "Admin is a product decision, not a default",
    description:
      "Do not invent Admin for every project. Detect whether admin is needed, what type (internal/customer/super/support/ops/finance/content/security), and separation level (in-app / separate FE / RBAC-only).",
    severityIfMissing: "MEDIUM",
    profiles: [...A],
    detectorKey: "admin_necessity",
    remediationHint:
      "Ask: Does this product require administrative capabilities? If yes, pick surface + role types; if no, skip /admin scaffolding.",
  }),
  item({
    id: "sec.admin_server_authz",
    domain: "SECURITY",
    title: "Admin authorization enforced on the server",
    description:
      "If an admin UI exists, Authentication→Authorization→RBAC must run on the API — never frontend-only role === admin",
    severityIfMissing: "CRITICAL",
    profiles: ["SAAS", "INTERNAL_TOOL", "PAYMENTS", "WEB_APP"],
    detectorKey: "admin_server_authz",
    remediationHint:
      "Enforce requireAdmin/requireRole on sensitive routes; add audit for dangerous actions",
  }),
  item({
    id: "sec.admin_overbuild",
    domain: "ARCHITECTURE",
    title: "No unnecessary Admin console complexity",
    description:
      "Admin UI without evidenced business need adds attack surface and maintenance cost",
    severityIfMissing: "LOW",
    profiles: ["WEB_APP", "MARKETING_SITE", "API_SERVICE"],
    detectorKey: "admin_overbuild",
    remediationHint:
      "Remove unused /admin or document the business role types that justify it",
  }),

  // Deepen Security / A11y / Config / AI Safety (P2)
  item({
    id: "sec.csrf_xss",
    domain: "SECURITY",
    title: "CSRF / XSS / injection defenses considered",
    description: "Helmet, sanitize, parameterized queries, or CSRF tokens",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "WEB_APP", "API_SERVICE", "PAYMENTS"],
    detectorKey: "sec_csrf_xss",
    remediationHint: "Add CSRF for cookie sessions; sanitize HTML; never concat SQL",
  }),
  item({
    id: "sec.tenant_isolation",
    domain: "SECURITY",
    title: "Tenant / owner isolation signal",
    description: "RLS, ownerId filters, or tenant scoping for multi-tenant SaaS",
    severityIfMissing: "CRITICAL",
    profiles: ["SAAS", "PAYMENTS"],
    detectorKey: "sec_tenant_isolation",
    remediationHint: "Enforce tenant/owner checks in queries + RLS policies",
  }),
  item({
    id: "a11y.keyboard_focus",
    domain: "ACCESSIBILITY",
    title: "Keyboard / focus management",
    description: "Focus rings, skip links, onKeyDown, tabIndex patterns",
    severityIfMissing: "HIGH",
    profiles: ["WEB_APP", "SAAS", "MARKETING_SITE"],
    detectorKey: "a11y_keyboard_focus",
    remediationHint: "Visible focus + skip-to-content + dialog focus trap",
  }),
  item({
    id: "a11y.reduced_motion",
    domain: "ACCESSIBILITY",
    title: "Reduced motion / contrast awareness",
    description: "prefers-reduced-motion or contrast-aware styles",
    severityIfMissing: "MEDIUM",
    profiles: ["WEB_APP", "SAAS", "MARKETING_SITE"],
    detectorKey: "a11y_reduced_motion",
    remediationHint: "Respect prefers-reduced-motion; verify contrast",
  }),
  item({
    id: "cfg.feature_flags",
    domain: "CONFIGURATION",
    title: "Feature flags / staged config",
    description: "Flag system or staging/prod config split",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "WEB_APP"],
    detectorKey: "cfg_feature_flags",
    remediationHint: "Separate staging/prod env; optional feature flags",
  }),
  item({
    id: "cfg.secret_manager",
    domain: "CONFIGURATION",
    title: "Secrets not only in plain .env for prod path",
    description: "Secret manager / vault / platform secrets signal",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "PAYMENTS"],
    detectorKey: "cfg_secret_manager",
    remediationHint: "Use platform secrets / vault in production docs",
  }),
  item({
    id: "ai.prompt_injection",
    domain: "AI_SAFETY",
    title: "Prompt-injection / tool isolation considered",
    description: "Tool allowlists, untrusted input labeling, or isolation notes",
    severityIfMissing: "HIGH",
    profiles: [...AI, "SAAS"],
    detectorKey: "ai_prompt_injection",
    remediationHint: "Treat user content as untrusted; constrain tools",
  }),
  item({
    id: "ai.egress_redaction",
    domain: "AI_SAFETY",
    title: "Secret redaction before LLM egress",
    description: "redactSecrets / assertNoSecrets on agent paths",
    severityIfMissing: "CRITICAL",
    profiles: [...AI],
    detectorKey: "ai_egress_redaction",
    remediationHint: "Redact secrets before every LLM/log egress",
  }),

  // Depth: reliability / API / testing / observability / config / deploy
  item({
    id: "api.pagination",
    domain: "API",
    title: "List API pagination",
    description: "Cursor, page/limit, or Link-rel pagination for collections",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE"],
    detectorKey: "api_pagination",
    remediationHint: "Paginate list endpoints (cursor or limit/offset); avoid unbounded dumps",
  }),
  item({
    id: "obs.correlation_ids",
    domain: "OBSERVABILITY",
    title: "Correlation / request IDs",
    description: "requestId, correlationId, x-request-id, or traceparent for log joining",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "AI_PRODUCT", "PAYMENTS"],
    detectorKey: "obs_correlation_ids",
    remediationHint: "Propagate request/correlation IDs on every API log line",
  }),
  item({
    id: "deploy.rollback",
    domain: "DEPLOYMENT",
    title: "Rollback / progressive delivery",
    description: "Rollback, blue-green, canary, or rollout revision signals",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "API_SERVICE", "WEB_APP", "PAYMENTS"],
    detectorKey: "deploy_rollback",
    remediationHint: "Document rollback; prefer blue-green/canary for risky deploys",
  }),
  item({
    id: "test.critical_path",
    domain: "TESTING",
    title: "Critical-path test coverage hints",
    description: "Auth/payment/webhook/checkout named tests or describe blocks",
    severityIfMissing: "HIGH",
    profiles: ["SAAS", "PAYMENTS", "WEB_APP", "API_SERVICE"],
    detectorKey: "test_critical_path",
    remediationHint: "Name and cover auth, payment, and webhook critical paths",
  }),
  item({
    id: "rel.circuit_breaker",
    domain: "RELIABILITY",
    title: "Circuit breaker / bulkhead for externals",
    description: "Circuit breaker, bulkhead, or resilience library signals",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "PAYMENTS", "AI_PRODUCT"],
    detectorKey: "rel_circuit_breaker",
    remediationHint: "Wrap flaky externals with circuit breaker + timeout",
  }),
  item({
    id: "obs.tracing",
    domain: "OBSERVABILITY",
    title: "Distributed tracing",
    description: "OpenTelemetry, dd-trace, or span instrumentation",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "AI_PRODUCT"],
    detectorKey: "obs_tracing",
    remediationHint: "Add OTel (or equivalent) spans on request + external calls",
  }),
  item({
    id: "rel.graceful_shutdown",
    domain: "RELIABILITY",
    title: "Graceful shutdown / SIGTERM drain",
    description: "SIGTERM handlers, server.close, or shutdown hooks",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "AI_PRODUCT"],
    detectorKey: "rel_graceful_shutdown",
    remediationHint: "Drain in-flight work on SIGTERM before exit",
  }),
  item({
    id: "cfg.env_validation",
    domain: "CONFIGURATION",
    title: "Validated environment schema",
    description: "Zod/t3-env/envsafe (or equivalent) validates process.env at boot",
    severityIfMissing: "MEDIUM",
    profiles: ["SAAS", "API_SERVICE", "WEB_APP", "PAYMENTS"],
    detectorKey: "cfg_env_validation",
    remediationHint: "Fail fast on missing/invalid env with a typed schema",
  }),
];

export function checklistById(
  id: string,
): ConstitutionChecklistItem | undefined {
  return CONSTITUTION_CHECKLIST.find((c) => c.id === id);
}
