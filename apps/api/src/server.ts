import Fastify from "fastify";
import { AtlasError } from "@atlas/shared";
import { loadServerEnv, type ServerEnv } from "@atlas/config";
import { buildApp } from "./create-app.js";

function listenPort(envPort: number): number {
  const fromVercel = process.env.PORT?.trim();
  if (fromVercel) {
    const n = Number(fromVercel);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return envPort;
}

function configErrorMessage(error: unknown): string {
  if (error instanceof AtlasError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "unknown startup error";
}

/** Keep the process alive on Vercel with a clear 503 instead of crashing the function. */
async function listenConfigFailure(message: string): Promise<void> {
  const app = Fastify({ logger: false });
  app.all("/*", async (_request, reply) =>
    reply.status(503).send({
      error: {
        code: "CONFIG_ERROR",
        message,
        hint: "Set DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY (≥32), COOKIE_SECRET (≥32), and WEB_ORIGIN in the Vercel project env.",
      },
    }),
  );
  const port = listenPort(4000);
  await app.listen({ port, host: "0.0.0.0" });
  console.error(
    JSON.stringify({
      level: "error",
      message,
      service: "atlas-api",
      port,
    }),
  );
}

async function main(): Promise<void> {
  let env: ServerEnv;
  try {
    env = loadServerEnv();
  } catch (error: unknown) {
    await listenConfigFailure(configErrorMessage(error));
    return;
  }

  const app = await buildApp(env);
  const port = listenPort(env.API_PORT);
  await app.listen({ port, host: "0.0.0.0" });
  app.atlasLogger.info("api_started", {
    port,
    product: env.APP_NAME,
    codename: env.PRODUCT_CODENAME,
  });
}

main().catch(async (error: unknown) => {
  const message = configErrorMessage(error);
  console.error(
    JSON.stringify({ level: "error", message, service: "atlas-api" }),
  );
  if (process.env.VERCEL) {
    try {
      await listenConfigFailure(message);
      return;
    } catch {
      // fall through
    }
  }
  process.exit(1);
});
