import { z } from "zod";
import { AtlasError } from "@atlas/shared";
import { loadDotEnv, loadServerDotEnv } from "./load-dotenv.js";

const emptyToUndefined = (value: unknown): unknown =>
  value === "" || value === undefined ? undefined : value;

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("ArletOS"),
  PRODUCT_CODENAME: z.string().default("Atlas"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const serverEnvSchema = baseEnvSchema.extend({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: optionalUrl,
  ENCRYPTION_KEY: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  GITHUB_APP_ID: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
  GITHUB_WEBHOOK_SECRET: optionalString,
  /** Public app slug for https://github.com/apps/{slug}/installations/new */
  GITHUB_APP_SLUG: optionalString,
  /** Fallback display name used to derive slug when GITHUB_APP_SLUG is unset */
  GITHUB_APP_NAME: optionalString,
  /** freemium — ADR-011 */
  ATLAS_PLAN: z.preprocess(emptyToUndefined, z.enum(["free", "pro"]).optional()),
  ATLAS_CLOUD_PROJECT_LIMIT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ATLAS_OWNER_ID: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  ATLAS_ADMIN_EMAIL: z.preprocess(
    emptyToUndefined,
    z.string().email().optional(),
  ),
  /** Atlas 1.1 Golden Project (BrokerOS path) */
  ATLAS_GOLDEN_PROJECT_ROOT: optionalString,
  ATLAS_GOLDEN_PROJECT_SLUG: optionalString,
  ATLAS_EVALS_ROOT: optionalString,
  /** Parent folder of local apps for portfolio discovery (dev-friendly). */
  ATLAS_LOCAL_REPOS_ROOT: optionalString,
  /**
   * When true, LOW AUTO_FIX remediation drafts may auto-approve+apply after
   * detect — still requires a signed-in WRITE session. HIGH/CRITICAL never.
   */
  ATLAS_AUTO_APPLY_LOW: z.preprocess((v) => {
    if (v === "" || v === undefined) return undefined;
    if (typeof v === "boolean") return v;
    const s = String(v).toLowerCase();
    if (s === "1" || s === "true" || s === "yes") return true;
    if (s === "0" || s === "false" || s === "no") return false;
    return undefined;
  }, z.boolean().optional()),

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalUrl,
  OPENAI_MODEL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_MODEL: optionalString,
  /** echo | ollama | groq | openai | anthropic | gemini | deepseek */
  LLM_PROVIDER: optionalString,
  OLLAMA_BASE_URL: optionalUrl,
  OLLAMA_MODEL: optionalString,
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString,
  SENTRY_DSN: optionalUrl,
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
});

const webEnvSchema = baseEnvSchema.extend({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("ArletOS"),
  NEXT_PUBLIC_PRODUCT_CODENAME: z.string().default("Atlas"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadServerEnv(
  source: NodeJS.ProcessEnv = process.env,
  options?: { readonly loadEnvFile?: boolean },
): ServerEnv {
  if (options?.loadEnvFile !== false && source === process.env) {
    loadServerDotEnv();
  }

  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new AtlasError(
      "CONFIG_ERROR",
      `Invalid server environment: ${issues}`,
      { statusCode: 500 },
    );
  }

  if (result.data.NODE_ENV === "production") {
    assertProductionSecrets(result.data);
    assertNotExampleSecrets(result.data);
  }

  return result.data;
}

export function loadWebEnv(
  source: NodeJS.ProcessEnv = process.env,
  options?: { readonly loadEnvFile?: boolean },
): WebEnv {
  if (options?.loadEnvFile !== false && source === process.env) {
    loadDotEnv();
  }

  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new AtlasError(
      "CONFIG_ERROR",
      `Invalid web environment: ${issues}`,
      { statusCode: 500 },
    );
  }
  return result.data;
}

function assertProductionSecrets(env: ServerEnv): void {
  const required = [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ENCRYPTION_KEY",
    "COOKIE_SECRET",
  ] as const;

  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new AtlasError(
      "CONFIG_ERROR",
      `Missing production secrets: ${missing.join(", ")}. Refusing to start.`,
      { statusCode: 500 },
    );
  }
}

const EXAMPLE_SECRET = "12345678901234567890123456789012";

function assertNotExampleSecrets(env: ServerEnv): void {
  if (env.ENCRYPTION_KEY === EXAMPLE_SECRET || env.COOKIE_SECRET === EXAMPLE_SECRET) {
    throw new AtlasError(
      "CONFIG_ERROR",
      "ENCRYPTION_KEY / COOKIE_SECRET still use the documented example value. Refusing to start in production.",
      { statusCode: 500 },
    );
  }
}
