import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { loadServerEnv, type ServerEnv } from "@atlas/config";
import { errorHandler } from "../../middleware/error-handler.js";

/**
 * Minimal Fastify app for route-level integration tests: only the error
 * handler + atlasEnv decoration + whatever route module(s) the test
 * registers. Deliberately skips buildApp()'s cloud-hydrate / dev-local
 * bootstrap / knowledge-refresh-interval side effects so tests stay fast,
 * offline, and isolated.
 */
export function buildTestEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return loadServerEnv(
    {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://localhost:5432/atlas_test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      ENCRYPTION_KEY: "12345678901234567890123456789012",
      COOKIE_SECRET: "12345678901234567890123456789012",
      LLM_PROVIDER: "echo",
      ...overrides,
    } as unknown as NodeJS.ProcessEnv,
    { loadEnvFile: false },
  );
}

export async function buildRouteTestApp(
  register: (app: FastifyInstance) => Promise<void>,
  envOverrides: Partial<ServerEnv> = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });
  app.setErrorHandler(errorHandler);
  app.decorate("atlasEnv", buildTestEnv(envOverrides));
  await register(app);
  await app.ready();
  return app;
}
