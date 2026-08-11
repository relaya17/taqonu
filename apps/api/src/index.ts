import { AtlasError } from "@atlas/shared";
import { loadServerEnv } from "@atlas/config";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const env = loadServerEnv();
  const app = await buildApp(env);

  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  app.atlasLogger.info("api_started", {
    port: env.API_PORT,
    product: env.APP_NAME,
    codename: env.PRODUCT_CODENAME,
  });
}

main().catch((error: unknown) => {
  const message =
    error instanceof AtlasError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "unknown startup error";
  console.error(JSON.stringify({ level: "error", message, service: "atlas-api" }));
  process.exit(1);
});
