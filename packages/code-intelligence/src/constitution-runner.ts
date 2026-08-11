import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  constitutionReportSchema,
  engineeringIssueSchema,
  omissionFindingSchema,
  type ConstitutionChecklistItem,
  type ConstitutionDomain,
  type ConstitutionReport,
  type EngineeringIssue,
  type ProductProfile,
} from "@atlas/shared";
import { readTextFile } from "./analyze.js";
import { CONSTITUTION_CHECKLIST } from "./constitution-checklist.js";
import {
  analyzeAdminNecessity,
  adminNecessitySummary,
} from "./admin-necessity.js";
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
import { looksLikeEmbeddedSecret } from "./secret-heuristics.js";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".atlas",
]);

function walk(root: string, limit = 700): string[] {
  const out: string[] = [];
  const rec = (dir: string) => {
    if (out.length >= limit) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) rec(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  if (existsSync(root)) rec(root);
  return out;
}

function remediationFor(
  severity: EngineeringIssue["severity"],
): EngineeringIssue["remediationPolicy"] {
  if (severity === "LOW") return "AUTO_FIX";
  if (severity === "MEDIUM") return "PR_REVIEW";
  if (severity === "HIGH") return "RECOMMENDATION_ONLY";
  return "HUMAN_APPROVAL";
}

function categoryFor(
  domain: ConstitutionDomain,
): EngineeringIssue["category"] {
  const map: Partial<Record<ConstitutionDomain, EngineeringIssue["category"]>> =
    {
      ARCHITECTURE: "ARCHITECTURE",
      SECURITY: "SECURITY",
      NAVIGATION: "NAVIGATION",
      FOOTER: "NAVIGATION",
      ACCESSIBILITY: "ACCESSIBILITY",
      RESPONSIVE: "UX",
      UI_CONSISTENCY: "UI_CONSISTENCY",
      UX: "UX",
      PERFORMANCE: "PERFORMANCE",
      DATABASE: "DATABASE",
      API: "API",
      TESTING: "TESTING",
      DEPENDENCIES: "DEPENDENCY",
      CONFIGURATION: "CONFIGURATION",
      DEPLOYMENT: "DEPLOYMENT",
      OBSERVABILITY: "OBSERVABILITY",
      RELIABILITY: "RELIABILITY",
      EXTERNAL_APIS: "EXTERNAL_API",
      DOCUMENTATION: "DOCUMENTATION",
      CODE_HYGIENE: "CODE_HYGIENE",
      I18N: "I18N",
      LEGAL_PRIVACY: "LEGAL",
      AI_SAFETY: "AI_SAFETY",
    };
  return map[domain] ?? "CONSTITUTION";
}

export function detectProductProfiles(
  files: string[],
  blob: string,
  intent?: string,
): ProductProfile[] {
  const profiles = new Set<ProductProfile>(["ALL"]);
  const q = `${blob}\n${intent ?? ""}`.toLowerCase();
  const hasWeb =
    files.some((f) => f.includes("apps/web") || f.startsWith("app/")) ||
    /next\.config|react|mui/.test(q);
  if (hasWeb) profiles.add("WEB_APP");
  if (
    /saas|supabase|stripe|billing|tenant|multi-tenant|atlas|arletos/.test(q) ||
    files.some((f) => f.includes("apps/api"))
  ) {
    profiles.add("SAAS");
  }
  if (/stripe|payment|checkout|billing|refund|invoice/.test(q)) {
    profiles.add("PAYMENTS");
  }
  if (
    files.some((f) => f.includes("apps/api") || f.includes("/routes/")) &&
    !hasWeb
  ) {
    profiles.add("API_SERVICE");
  }
  if (/marketing|landing|investors/.test(q) && hasWeb) {
    profiles.add("MARKETING_SITE");
  }
  // INTERNAL_TOOL only when ops/internal product intent — not merely because /admin exists
  if (
    /\binternal[-_\s]?tool\b|\bops\s*console\b|backoffice|staff[-_\s]?portal/i.test(
      q,
    ) ||
    (inputIntentLooksInternal(intent) && /admin/.test(q))
  ) {
    profiles.add("INTERNAL_TOOL");
  }
  if (
    /llm|openai|ollama|agent|prompt|embedding|ai safety|atlas/.test(q) ||
    files.some((f) => f.includes("agent-core") || f.includes("embeddings"))
  ) {
    profiles.add("AI_PRODUCT");
  }
  return [...profiles];
}

function inputIntentLooksInternal(intent: string | undefined): boolean {
  if (!intent) return false;
  return /internal|ops|staff|backoffice|מערכת פנימית|תפעול/.test(
    intent.toLowerCase(),
  );
}

function itemApplicable(
  item: ConstitutionChecklistItem,
  profiles: ProductProfile[],
): boolean {
  if (item.profiles.includes("ALL")) return true;
  return item.profiles.some((p) => profiles.includes(p));
}

type DetectorResult = {
  status: "PASS" | "FAIL" | "WARN" | "UNKNOWN";
  evidenceRefs: string[];
  notes: string;
};

function buildSignals(root: string, files: string[]) {
  const sampleFiles = files.filter((f) =>
    /\.(ts|tsx|js|jsx|json|md|yml|yaml|env)$/i.test(f),
  );
  const texts: { rel: string; text: string }[] = [];
  for (const rel of sampleFiles.slice(0, 350)) {
    const text = readTextFile(root, rel);
    if (text && text.length < 200_000) texts.push({ rel, text });
  }
  const blob = texts.map((t) => t.text).join("\n");
  const names = files.join("\n");

  const has = (re: RegExp) => re.test(blob) || re.test(names);
  const fileHas = (re: RegExp) => files.some((f) => re.test(f));

  let secretHits = 0;
  let anyHits = 0;
  let frontendDb = 0;
  for (const { rel, text } of texts) {
    if (/\.(test|spec)\.(ts|tsx|js)$/i.test(rel) || rel.includes("__tests__")) {
      continue;
    }
    if (looksLikeEmbeddedSecret(text)) {
      secretHits += 1;
    }
    if (/:\s*any\b|as any\b/.test(text) && /\.(ts|tsx)$/.test(rel)) anyHits += 1;
    if (
      /(apps\/web|components\/|app\/\[locale\])/.test(rel) &&
      (/from ['\"]@?.*prisma|supabase\.from\(|\.from\(['\"][\w]+['\"]\)/i.test(text) ||
        /from ['\"].*\/(database|repositories)\//i.test(text))
    ) {
      frontendDb += 1;
    }
  }

  return {
    files,
    blob,
    names,
    has,
    fileHas,
    secretHits,
    anyHits,
    frontendDb,
    texts,
    admin: analyzeAdminNecessity({ blob, names }),
  };
}

type Signals = ReturnType<typeof buildSignals>;

function runDetector(key: string, s: Signals): DetectorResult {
  switch (key) {
    case "arch_no_frontend_db":
      return s.frontendDb === 0
        ? {
            status: "PASS",
            evidenceRefs: ["frontend-db-scan"],
            notes: "No Frontend→Database pattern in sample",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["frontend-db-scan"],
            notes: `${s.frontendDb} Frontend→Database hit(s)`,
          };
    case "arch_structure":
      return s.fileHas(/^(apps|packages)\//) || s.fileHas(/^src\//)
        ? {
            status: "PASS",
            evidenceRefs: ["tree"],
            notes: "apps/packages or src layout observed",
          }
        : {
            status: "WARN",
            evidenceRefs: ["tree"],
            notes: "Flat or unclear structure in sample",
          };
    case "arch_shared_types":
      return s.fileHas(/packages\/shared|schemas\/|\.schema\./)
        ? {
            status: "PASS",
            evidenceRefs: ["packages/shared"],
            notes: "Shared contracts present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["tree"],
            notes: "No shared schema package detected",
          };
    case "sec_auth_present":
      return s.has(/auth|login|session|oauth|supabase\.auth/i)
        ? {
            status: "PASS",
            evidenceRefs: ["auth-scan"],
            notes: "Auth-related symbols present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["auth-scan"],
            notes: "No auth surface detected for applicable profile",
          };
    case "sec_no_hardcoded_secrets":
      return s.secretHits === 0
        ? {
            status: "PASS",
            evidenceRefs: ["secret-scan"],
            notes: "No secret-like patterns in sample",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["secret-scan"],
            notes: `${s.secretHits} secret-like hit(s)`,
          };
    case "sec_env_example":
      return s.fileHas(/\.env\.example|\.env\.sample/)
        ? {
            status: "PASS",
            evidenceRefs: [".env.example"],
            notes: "Env template present",
          }
        : {
            status: "WARN",
            evidenceRefs: ["env"],
            notes: "Missing .env.example",
          };
    case "sec_cors_or_headers":
      return s.has(/cors|content-security-policy|helmet|securityHeaders/i)
        ? {
            status: "PASS",
            evidenceRefs: ["cors-scan"],
            notes: "CORS/headers signal found",
          }
        : {
            status: "WARN",
            evidenceRefs: ["cors-scan"],
            notes: "No CORS/security header signal",
          };
    case "sec_rate_limit":
      return s.has(/rateLimit|rate-limit|ratelimit|throttle/i)
        ? {
            status: "PASS",
            evidenceRefs: ["rate-limit"],
            notes: "Rate limit signal found",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["rate-limit"],
            notes: "No rate limiting signal",
          };
    case "nav_primary":
      return s.has(/AppShell|Navbar|Sidebar|navigation|navItems/i) ||
        s.fileHas(/layout\.tsx|AppShell/)
        ? {
            status: "PASS",
            evidenceRefs: ["nav"],
            notes: "Primary navigation signal",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["nav"],
            notes: "No primary nav signal",
          };
    case "nav_error_states":
      return s.fileHas(/not-found|unauthorized|forbidden|404/) ||
        s.has(/notFound|unauthorized|forbidden/i)
        ? {
            status: "PASS",
            evidenceRefs: ["error-pages"],
            notes: "Error/unauthorized UI signal",
          }
        : {
            status: "WARN",
            evidenceRefs: ["error-pages"],
            notes: "Missing 404/unauthorized pages",
          };
    case "footer_legal":
      return s.has(/privacy|terms of|cookie|footer/i)
        ? {
            status: "PASS",
            evidenceRefs: ["footer"],
            notes: "Legal/footer signals present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["footer"],
            notes: "No Privacy/Terms/footer legal signal",
          };
    case "a11y_signals":
      return s.has(/aria-|htmlFor|role=|VisuallyHidden|a11y/i)
        ? {
            status: "PASS",
            evidenceRefs: ["a11y"],
            notes: "A11y attributes/patterns found",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["a11y"],
            notes: "Weak a11y signal in sample",
          };
    case "a11y_rtl":
      return s.has(/\brtl\b|dir=|next-intl|locale/i) ||
        s.fileHas(/messages\/(he|ar)\.json/)
        ? {
            status: "PASS",
            evidenceRefs: ["rtl"],
            notes: "RTL/locale support signal",
          }
        : {
            status: "WARN",
            evidenceRefs: ["rtl"],
            notes: "No RTL/locale signal",
          };
    case "resp_breakpoints":
      return s.has(/@media|breakpoints|useMediaQuery|\b(sm|md|lg|xl):/i)
        ? {
            status: "PASS",
            evidenceRefs: ["responsive"],
            notes: "Breakpoint signals found",
          }
        : {
            status: "WARN",
            evidenceRefs: ["responsive"],
            notes: "Limited responsive signals",
          };
    case "ui_theme":
      return s.has(/createTheme|ThemeProvider|CssBaseline|design.system/i)
        ? {
            status: "PASS",
            evidenceRefs: ["theme"],
            notes: "Theme/design-system signal",
          }
        : {
            status: "WARN",
            evidenceRefs: ["theme"],
            notes: "No shared theme signal",
          };
    case "ux_empty_loading":
      return s.has(/EmptyState|Loading|Skeleton|isPending|isLoading/i)
        ? {
            status: "PASS",
            evidenceRefs: ["ux-states"],
            notes: "Loading/empty patterns found",
          }
        : {
            status: "WARN",
            evidenceRefs: ["ux-states"],
            notes: "Few empty/loading patterns",
          };
    case "perf_code_split":
      return s.has(/next\/dynamic|React\.lazy|import\(/)
        ? {
            status: "PASS",
            evidenceRefs: ["code-split"],
            notes: "Dynamic import signal",
          }
        : {
            status: "UNKNOWN",
            evidenceRefs: ["code-split"],
            notes: "No dynamic import observed (may still be fine)",
          };
    case "db_migrations":
      return s.fileHas(/migrations\/|prisma\/migrations/)
        ? {
            status: "PASS",
            evidenceRefs: ["migrations"],
            notes: "Migrations folder present",
          }
        : s.has(/supabase|prisma|drizzle|mongodb/i)
          ? {
              status: "FAIL",
              evidenceRefs: ["migrations"],
              notes: "DB signals without migrations folder",
            }
          : {
              status: "UNKNOWN",
              evidenceRefs: ["migrations"],
              notes: "No DB usage clear in sample",
            };
    case "db_schema":
      return s.fileHas(/schema\.prisma|drizzle|supabase\/migrations|\.sql$/)
        ? {
            status: "PASS",
            evidenceRefs: ["schema"],
            notes: "Schema definition present",
          }
        : {
            status: "WARN",
            evidenceRefs: ["schema"],
            notes: "No schema file detected",
          };
    case "api_validation":
      return s.has(/\.parse\(|z\.object|safeParse|validator/i)
        ? {
            status: "PASS",
            evidenceRefs: ["validation"],
            notes: "Schema validation present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["validation"],
            notes: "No Zod/schema validation signal",
          };
    case "api_errors":
      return detectApiErrors(s.has);
    case "test_suite":
      return s.fileHas(/\.(test|spec)\.|vitest|playwright|jest/)
        ? {
            status: "PASS",
            evidenceRefs: ["tests"],
            notes: "Test files/config present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["tests"],
            notes: "No tests detected",
          };
    case "test_e2e_or_api":
      return s.fileHas(/playwright|e2e\/|api\.test|supertest/)
        ? {
            status: "PASS",
            evidenceRefs: ["e2e"],
            notes: "E2E/API test signal",
          }
        : {
            status: "WARN",
            evidenceRefs: ["e2e"],
            notes: "No E2E/API integration tests found",
          };
    case "deps_lockfile":
      return s.fileHas(/pnpm-lock\.yaml|package-lock\.json|yarn\.lock/)
        ? {
            status: "PASS",
            evidenceRefs: ["lockfile"],
            notes: "Lockfile present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["lockfile"],
            notes: "Lockfile missing",
          };
    case "deps_no_floating":
      return /\"\*[\"']|\"latest\"/.test(s.blob)
        ? {
            status: "FAIL",
            evidenceRefs: ["package.json"],
            notes: "Floating * or latest found",
          }
        : {
            status: "PASS",
            evidenceRefs: ["package.json"],
            notes: "No floating ranges in sample manifests",
          };
    case "cfg_env":
      return s.has(/process\.env|atlasEnv|dotenv|ATLAS_/i)
        ? {
            status: "PASS",
            evidenceRefs: ["config"],
            notes: "Env-based config present",
          }
        : {
            status: "WARN",
            evidenceRefs: ["config"],
            notes: "Weak env config signal",
          };
    case "deploy_ci":
      return s.fileHas(/\.github\/workflows|vercel\.json|netlify\.toml|render\.yaml/)
        ? {
            status: "PASS",
            evidenceRefs: ["ci"],
            notes: "CI/deploy config present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["ci"],
            notes: "No CI/deploy config in sample",
          };
    case "deploy_health":
      return detectDeployHealth(s.has, s.fileHas);
    case "obs_logging":
      return s.fileHas(/observability|logger/) ||
        s.has(/pino|winston|otel|sentry|structured log/i)
        ? {
            status: "PASS",
            evidenceRefs: ["observability"],
            notes: "Logging/observability present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["observability"],
            notes: "Weak observability signal",
          };
    case "rel_timeout_retry":
      return detectRelTimeoutRetry(s.has);
    case "rel_idempotency":
      return s.has(/idempotenc|idempotent|Idempotency-Key/i)
        ? {
            status: "PASS",
            evidenceRefs: ["idempotency"],
            notes: "Idempotency signal found",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["idempotency"],
            notes: "Payments profile without idempotency signal",
          };
    case "ext_webhook_verify":
      if (!s.has(/webhook/i)) {
        return {
          status: "UNKNOWN",
          evidenceRefs: ["webhooks"],
          notes: "No webhook usage observed — N/A soft",
        };
      }
      return s.has(/signature|constructEvent|timingSafeEqual|x-hub-signature/i)
        ? {
            status: "PASS",
            evidenceRefs: ["webhook-verify"],
            notes: "Webhook verification signal",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["webhook-verify"],
            notes: "Webhooks without signature verification signal",
          };
    case "docs_readme":
      return s.fileHas(/^README\.md$/i)
        ? {
            status: "PASS",
            evidenceRefs: ["README.md"],
            notes: "README present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["README"],
            notes: "Missing README",
          };
    case "docs_adr":
      return s.fileHas(/docs\/adr|ADR-\d+/)
        ? {
            status: "PASS",
            evidenceRefs: ["docs/adr"],
            notes: "ADRs present",
          }
        : {
            status: "WARN",
            evidenceRefs: ["docs/adr"],
            notes: "No ADR folder",
          };
    case "hyg_any":
      return s.anyHits >= 12
        ? {
            status: "FAIL",
            evidenceRefs: [`anyFiles=${s.anyHits}`],
            notes: `Elevated any usage (${s.anyHits})`,
          }
        : {
            status: "PASS",
            evidenceRefs: [`anyFiles=${s.anyHits}`],
            notes: `any density acceptable (${s.anyHits})`,
          };
    case "i18n_messages":
      return s.fileHas(/messages\/(he|en|ar)\.json|locales\//) ||
        s.has(/next-intl|useTranslations/i)
        ? {
            status: "PASS",
            evidenceRefs: ["i18n"],
            notes: "Locale catalogs / next-intl present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["i18n"],
            notes: "No real i18n catalogs detected",
          };
    case "legal_privacy":
      return s.has(/privacy|GDPR|data retention|cookie consent/i) ||
        s.fileHas(/privacy/i)
        ? {
            status: "PASS",
            evidenceRefs: ["privacy"],
            notes: "Privacy surface signal",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["privacy"],
            notes: "No Privacy policy signal for public profile",
          };
    case "ai_write_gate":
      return s.has(/WRITE|approval-gated|tool-policy|approvalStatus|HUMAN_APPROVAL/i)
        ? {
            status: "PASS",
            evidenceRefs: ["write-gate"],
            notes: "Write/approval gate signals",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["write-gate"],
            notes: "AI product without clear write gate",
          };
    case "ai_evidence":
      return s.has(/INSUFFICIENT_EVIDENCE|epistemicState|Evidence Graph|evidenceRefs/i)
        ? {
            status: "PASS",
            evidenceRefs: ["evidence"],
            notes: "Evidence/epistemic requirements present",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["evidence"],
            notes: "Missing evidence requirements for AI paths",
          };
    case "admin_necessity": {
      const a = s.admin;
      const notes = adminNecessitySummary(a);
      if (!a.needsAdmin && !a.hasAdminUi) {
        return {
          status: "PASS",
          evidenceRefs: ["admin-necessity"],
          notes,
        };
      }
      if (a.needsAdmin && a.hasServerAuthz) {
        return {
          status: "PASS",
          evidenceRefs: ["admin-necessity", ...a.needReasons.slice(0, 4)],
          notes,
        };
      }
      if (a.needsAdmin && !a.hasServerAuthz) {
        return {
          status: "WARN",
          evidenceRefs: ["admin-necessity", ...a.needReasons.slice(0, 4)],
          notes,
        };
      }
      return {
        status: "WARN",
        evidenceRefs: ["admin-necessity"],
        notes,
      };
    }
    case "admin_server_authz": {
      const a = s.admin;
      if (!a.hasAdminUi && !a.needsAdmin) {
        return {
          status: "PASS",
          evidenceRefs: ["admin-authz"],
          notes: "No admin surface — server authz N/A",
        };
      }
      if (a.frontendOnlyRisk || (a.hasAdminUi && !a.hasServerAuthz)) {
        return {
          status: "FAIL",
          evidenceRefs: ["admin-authz", a.inferredSurface],
          notes:
            "Admin UI without evidenced server Authorization/RBAC — frontend role checks are not security",
        };
      }
      if (a.needsAdmin && !a.hasServerAuthz) {
        return {
          status: "FAIL",
          evidenceRefs: ["admin-authz", ...a.needReasons.slice(0, 3)],
          notes: adminNecessitySummary(a),
        };
      }
      return {
        status: "PASS",
        evidenceRefs: ["admin-authz"],
        notes: a.hasAdminAudit
          ? "Server admin authz + audit signals present"
          : "Server admin authz present; consider audit log for dangerous actions",
      };
    }
    case "admin_overbuild": {
      const a = s.admin;
      if (a.hasAdminUi && !a.needsAdmin) {
        return {
          status: "WARN",
          evidenceRefs: ["admin-overbuild", a.inferredSurface],
          notes: adminNecessitySummary(a),
        };
      }
      return {
        status: "PASS",
        evidenceRefs: ["admin-overbuild"],
        notes: a.hasAdminUi
          ? `Admin justified by: ${a.needReasons.join(", ") || "signals"}`
          : "No unnecessary admin console detected",
      };
    }
    case "sec_csrf_xss":
      return s.has(
        /csrf|helmet|sanitize|DOMPurify|parameterized|preparedStatement|sql\.raw|xss/i,
      )
        ? {
            status: "PASS",
            evidenceRefs: ["csrf-xss"],
            notes: "CSRF/XSS/injection defense signal",
          }
        : {
            status: "WARN",
            evidenceRefs: ["csrf-xss"],
            notes: "No CSRF/XSS/injection defense signal in sample",
          };
    case "sec_tenant_isolation":
      return s.has(/RLS|ownerId|tenantId|organizationId|row level security|auth\.uid/i)
        ? {
            status: "PASS",
            evidenceRefs: ["tenant"],
            notes: "Tenant/owner isolation signal",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["tenant"],
            notes: "SaaS profile without tenant/owner isolation evidence",
          };
    case "a11y_keyboard_focus":
      return s.has(
        /skip-link|skipToContent|outline|tabIndex|onKeyDown|focus-visible|:focus/i,
      )
        ? {
            status: "PASS",
            evidenceRefs: ["a11y-focus"],
            notes: "Keyboard/focus patterns found",
          }
        : {
            status: "WARN",
            evidenceRefs: ["a11y-focus"],
            notes: "Weak keyboard/focus signal",
          };
    case "a11y_reduced_motion":
      return s.has(/prefers-reduced-motion|reducedMotion|contrast/i)
        ? {
            status: "PASS",
            evidenceRefs: ["a11y-motion"],
            notes: "Reduced-motion/contrast awareness",
          }
        : {
            status: "WARN",
            evidenceRefs: ["a11y-motion"],
            notes: "No prefers-reduced-motion / contrast signal",
          };
    case "cfg_feature_flags":
      return s.has(
        /featureFlag|FEATURE_|staging|NODE_ENV.*production|launchdarkly|unleash/i,
      ) || s.fileHas(/\.env\.(staging|production)/)
        ? {
            status: "PASS",
            evidenceRefs: ["flags"],
            notes: "Feature flag / env split signal",
          }
        : {
            status: "WARN",
            evidenceRefs: ["flags"],
            notes: "No feature-flag or staging/prod split signal",
          };
    case "cfg_secret_manager":
      return detectCfgSecretManager(s.has);
    case "ai_prompt_injection":
      return s.has(
        /prompt.?injection|untrusted|tool.?allow|tool.?policy|sandbox|isolation/i,
      )
        ? {
            status: "PASS",
            evidenceRefs: ["prompt-inj"],
            notes: "Prompt-injection / tool isolation considered",
          }
        : {
            status: "WARN",
            evidenceRefs: ["prompt-inj"],
            notes: "No prompt-injection / tool-isolation signal",
          };
    case "ai_egress_redaction":
      return s.has(/redactSecrets|assertNoSecrets|REDACTED_SECRET/i)
        ? {
            status: "PASS",
            evidenceRefs: ["egress-redact"],
            notes: "Secret redaction on egress paths",
          }
        : {
            status: "FAIL",
            evidenceRefs: ["egress-redact"],
            notes: "AI product without redactSecrets/assertNoSecrets evidence",
          };
    case "api_pagination":
      return detectApiPagination(s.has);
    case "obs_correlation_ids":
      return detectObsCorrelationIds(s.has);
    case "deploy_rollback":
      return detectDeployRollback(s.has, s.fileHas);
    case "test_critical_path":
      return detectTestCriticalPath(s.has, s.fileHas);
    case "rel_circuit_breaker":
      return detectRelCircuitBreaker(s.has);
    case "obs_tracing":
      return detectObsTracing(s.has, s.fileHas);
    case "rel_graceful_shutdown":
      return detectRelGracefulShutdown(s.has);
    case "cfg_env_validation":
      return detectCfgEnvValidation(s.has);
    default:
      return {
        status: "UNKNOWN",
        evidenceRefs: [key],
        notes: `Detector not implemented: ${key}`,
      };
  }
}

/**
 * Omission Detector — finds critical gaps nobody asked for explicitly.
 */
export function detectOmissions(input: {
  profiles: ProductProfile[];
  results: ConstitutionReport["results"];
  intent?: string;
}): ConstitutionReport["omissions"] {
  const intent = (input.intent ?? "").toLowerCase();
  const failedIds = new Set(
    input.results
      .filter((r) => r.status === "FAIL" || r.status === "WARN")
      .map((r) => r.itemId),
  );
  const omissions: ConstitutionReport["omissions"] = [];

  const push = (o: {
    itemId: string | null;
    domain: ConstitutionDomain;
    title: string;
    whyCritical: string;
    evidenceGap: string;
    suggestedCheck: string;
    severity: EngineeringIssue["severity"];
    confidence: number;
  }) => {
    omissions.push(
      omissionFindingSchema.parse({
        id: crypto.randomUUID(),
        itemId: o.itemId,
        domain: o.domain,
        title: o.title,
        whyCritical: o.whyCritical,
        evidenceGap: o.evidenceGap,
        suggestedCheck: o.suggestedCheck,
        severity: o.severity,
        confidence: o.confidence,
        remediationPolicy: remediationFor(o.severity),
        epistemicState: "INFERRED",
      }),
    );
  };

  // Intent-driven classic: payments without webhook verify
  if (
    (/payment|stripe|checkout|billing|refund/.test(intent) ||
      input.profiles.includes("PAYMENTS")) &&
    failedIds.has("ext.webhook_verify")
  ) {
    push({
      itemId: "ext.webhook_verify",
      domain: "EXTERNAL_APIS",
      title: "Omission: webhook signature verification",
      whyCritical:
        "Payment/webhook systems without signature verification accept forged events",
      evidenceGap: "User asked for payments flow; verification not evidenced",
      suggestedCheck: "Verify Stripe/Meta/GitHub webhook signatures",
      severity: "CRITICAL",
      confidence: 0.85,
    });
  }

  if (
    (/payment|stripe|checkout/.test(intent) ||
      input.profiles.includes("PAYMENTS")) &&
    failedIds.has("rel.idempotency")
  ) {
    push({
      itemId: "rel.idempotency",
      domain: "RELIABILITY",
      title: "Omission: idempotency for payments",
      whyCritical: "Duplicate webhooks cause double charges / inconsistent state",
      evidenceGap: "Payments profile without idempotency evidence",
      suggestedCheck: "Idempotency-Key + dedupe store for webhooks",
      severity: "CRITICAL",
      confidence: 0.8,
    });
  }

  // Booking / SaaS site without a11y / nav
  if (
    (/אתר|site|booking|הזמנות|saas|app/.test(intent) ||
      input.profiles.includes("WEB_APP")) &&
    failedIds.has("nav.error_states")
  ) {
    push({
      itemId: "nav.error_states",
      domain: "NAVIGATION",
      title: "Omission: 404 / unauthorized navigation",
      whyCritical: "Users get lost or see blank failures on broken links",
      evidenceGap: "Web app without error navigation states",
      suggestedCheck: "Add not-found + unauthorized pages",
      severity: "MEDIUM",
      confidence: 0.7,
    });
  }

  if (
    input.profiles.includes("SAAS") &&
    failedIds.has("sec.rate_limit")
  ) {
    push({
      itemId: "sec.rate_limit",
      domain: "SECURITY",
      title: "Omission: API abuse / rate limiting",
      whyCritical: "Public SaaS APIs without rate limits are abuse magnets",
      evidenceGap: "SaaS profile; no rate-limit evidence",
      suggestedCheck: "Rate limit auth + public endpoints",
      severity: "HIGH",
      confidence: 0.75,
    });
  }

  if (
    input.profiles.includes("AI_PRODUCT") &&
    failedIds.has("ai.tool_gate")
  ) {
    push({
      itemId: "ai.tool_gate",
      domain: "AI_SAFETY",
      title: "Omission: human approval for high-risk AI writes",
      whyCritical: "Ungated AI WRITE can mutate production unsafely",
      evidenceGap: "AI product without approval-gated WRITE evidence",
      suggestedCheck: "Enforce HUMAN_APPROVAL for CRITICAL tools",
      severity: "CRITICAL",
      confidence: 0.8,
    });
  }

  // Admin necessity — ask before scaffolding; enforce on server if needed
  if (
    failedIds.has("sec.admin_server_authz") ||
    (/admin|מנהל|הרשאות|users|billing|tenant/.test(intent) &&
      failedIds.has("sec.admin_necessity"))
  ) {
    push({
      itemId: "sec.admin_server_authz",
      domain: "SECURITY",
      title: "Omission: admin capability without server authorization model",
      whyCritical:
        "Admin is a business/security need — if required, AuthN→AuthZ→RBAC must be server-enforced; /admin UI alone is not security. Atlas must not invent Admin by default.",
      evidenceGap:
        "Missing decision on admin type (internal/customer/super/support/ops/finance/content/security) and/or server enforcement",
      suggestedCheck:
        "Decide YES/NO admin → type → surface (in-app | separate FE | RBAC-only) → enforce on API + audit dangerous actions",
      severity: "CRITICAL",
      confidence: 0.78,
    });
  }

  // Generic: every CRITICAL fail becomes omission if not already listed
  for (const r of input.results) {
    if (r.status !== "FAIL" || r.severity !== "CRITICAL") continue;
    if (omissions.some((o) => o.itemId === r.itemId)) continue;
    push({
      itemId: r.itemId,
      domain: r.domain,
      title: `Omission risk: ${r.title}`,
      whyCritical: "Critical Constitution check failed — often forgotten until incident",
      evidenceGap: r.notes,
      suggestedCheck: r.title,
      severity: "CRITICAL",
      confidence: 0.65,
    });
  }

  return omissions;
}

function toIssue(input: {
  item: ConstitutionChecklistItem;
  status: "FAIL" | "WARN";
  evidenceRefs: string[];
  notes: string;
  omission?: boolean;
}): EngineeringIssue {
  const severity =
    input.status === "WARN" && input.item.severityIfMissing === "CRITICAL"
      ? "HIGH"
      : input.status === "WARN"
        ? input.item.severityIfMissing === "HIGH"
          ? "MEDIUM"
          : "LOW"
        : input.item.severityIfMissing;

  return engineeringIssueSchema.parse({
    id: crypto.randomUUID(),
    category: input.omission ? "OMISSION" : categoryFor(input.item.domain),
    severity,
    title: `${input.omission ? "Omission · " : "Constitution · "}${input.item.title}`,
    affectedComponents: input.evidenceRefs.slice(0, 5),
    rootCause: input.notes,
    evidence: input.evidenceRefs.map((ref) => ({
      ref,
      note: input.notes,
      epistemicState: "OBSERVED" as const,
    })),
    confidence: input.omission ? 0.7 : 0.75,
    recommendedFix: input.item.remediationHint,
    proposedPatchHint: null,
    testsSuggested: [`Constitution check ${input.item.id}`],
    regressionResult: "NOT_RUN",
    approvalStatus: "OPEN",
    remediationPolicy: remediationFor(severity),
    architectureViolation: input.item.domain === "ARCHITECTURE",
    constitutionDomain: input.item.domain,
    omission: input.omission ?? false,
  });
}

/** Run Engineering Constitution + Omission Detector over a workspace. */
export function runEngineeringConstitution(input: {
  workspaceRoot: string;
  projectId?: string | null;
  projectName?: string;
  intent?: string;
  profiles?: ProductProfile[];
}): ConstitutionReport {
  const root = input.workspaceRoot;
  const files = walk(root, 700);
  const signals = buildSignals(root, files);
  const detected =
    input.profiles && input.profiles.length > 0
      ? Array.from(new Set(["ALL" as ProductProfile, ...input.profiles]))
      : detectProductProfiles(files, signals.blob, input.intent);

  const results: ConstitutionReport["results"] = [];
  const issues: EngineeringIssue[] = [];

  for (const item of CONSTITUTION_CHECKLIST) {
    if (!itemApplicable(item, detected)) {
      results.push({
        itemId: item.id,
        domain: item.domain,
        title: item.title,
        status: "SKIPPED_NOT_APPLICABLE",
        severity: null,
        evidenceRefs: [],
        notes: `Not applicable for profiles: ${detected.join(",")}`,
        epistemicState: "FACT",
      });
      continue;
    }

    const det = runDetector(item.detectorKey, signals);
    const status =
      det.status === "PASS"
        ? "PASS"
        : det.status === "FAIL"
          ? "FAIL"
          : det.status === "WARN"
            ? "WARN"
            : "UNKNOWN";

    results.push({
      itemId: item.id,
      domain: item.domain,
      title: item.title,
      status,
      severity: status === "PASS" ? null : item.severityIfMissing,
      evidenceRefs: det.evidenceRefs,
      notes: det.notes,
      epistemicState: status === "UNKNOWN" ? "INFERRED" : "OBSERVED",
    });

    if (status === "FAIL" || status === "WARN") {
      issues.push(
        toIssue({
          item,
          status,
          evidenceRefs: det.evidenceRefs,
          notes: det.notes,
        }),
      );
    }
  }

  const omissions = detectOmissions({
    profiles: detected,
    results,
    ...(input.intent ? { intent: input.intent } : {}),
  });

  for (const o of omissions) {
    const item = CONSTITUTION_CHECKLIST.find((c) => c.id === o.itemId);
    if (item) {
      issues.push(
        toIssue({
          item,
          status: "FAIL",
          evidenceRefs: [o.evidenceGap],
          notes: o.whyCritical,
          omission: true,
        }),
      );
    } else {
      issues.push(
        engineeringIssueSchema.parse({
          id: crypto.randomUUID(),
          category: "OMISSION",
          severity: o.severity,
          title: o.title,
          affectedComponents: [],
          rootCause: o.whyCritical,
          evidence: [
            {
              ref: "omission-detector",
              note: o.evidenceGap,
              epistemicState: "INFERRED",
            },
          ],
          confidence: o.confidence,
          recommendedFix: o.suggestedCheck,
          proposedPatchHint: null,
          testsSuggested: [],
          regressionResult: "NOT_RUN",
          approvalStatus: "OPEN",
          remediationPolicy: o.remediationPolicy,
          architectureViolation: false,
          constitutionDomain: o.domain,
          omission: true,
        }),
      );
    }
  }

  const domains = [
    ...new Set(CONSTITUTION_CHECKLIST.map((c) => c.domain)),
  ] as ConstitutionDomain[];

  const domainScores = domains.map((domain) => {
    const applicable = results.filter(
      (r) =>
        r.domain === domain && r.status !== "SKIPPED_NOT_APPLICABLE",
    );
    const passed = applicable.filter((r) => r.status === "PASS").length;
    const failed = applicable.filter((r) => r.status === "FAIL").length;
    const warned = applicable.filter((r) => r.status === "WARN").length;
    const unknown = applicable.filter((r) => r.status === "UNKNOWN").length;
    const denom = Math.max(1, applicable.length);
    const score = Math.round(
      ((passed + warned * 0.5 + unknown * 0.7) / denom) * 100,
    );
    return {
      domain,
      score: Math.max(0, Math.min(100, score)),
      applicable: applicable.length,
      passed,
      failed,
      warned,
      unknown,
      evidenceRefs: applicable.flatMap((r) => r.evidenceRefs).slice(0, 5),
    };
  });

  const scored = domainScores.filter((d) => d.applicable > 0);
  const overallScore =
    scored.length === 0
      ? 0
      : Math.round(scored.reduce((a, d) => a + d.score, 0) / scored.length);

  const failedChecks = results.filter((r) => r.status === "FAIL").length;
  const summary = [
    `Engineering Constitution ${overallScore}/100.`,
    `Profiles: ${detected.filter((p) => p !== "ALL").join(", ") || "ALL"}.`,
    `Failed checks ${failedChecks} · Omissions ${omissions.length}.`,
    "Scores cite detector Evidence — not AI vibes.",
  ].join(" ");

  return constitutionReportSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? "Repository",
    workspaceRoot: root,
    detectedProfiles: detected,
    overallScore,
    domainScores,
    results,
    omissions,
    issues,
    plainLanguageSummary: summary,
    createdAt: new Date().toISOString(),
    epistemicState: "OBSERVED",
  });
}

export function listConstitutionChecklist(): ConstitutionChecklistItem[] {
  return [...CONSTITUTION_CHECKLIST];
}
