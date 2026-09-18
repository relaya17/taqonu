import type { FastifyInstance } from "fastify";
import { osStore } from "../store/os-store.js";
import { requireUser } from "../middleware/auth-guards.js";

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/integrations", async (request) => {
    const user = await requireUser(app, request);
    osStore.ensureLoaded();
    const github = osStore.getGithubConnection(user.id);
    const local = osStore.getLocalConnection(user.id);
    return {
      items: [
        {
          provider: "github",
          status: github?.status ?? "DISCONNECTED",
          displayName: github?.login ?? null,
          secretsPolicy: { metadataAllowed: true, secretValuesAllowed: false },
        },
        {
          provider: "local",
          status: local?.status ?? "DISCONNECTED",
          displayName: local?.reposRoot ?? null,
          secretsPolicy: { metadataAllowed: true, secretValuesAllowed: false },
        },
        {
          provider: "google",
          status: "DISCONNECTED",
          displayName: null,
          secretsPolicy: { metadataAllowed: true, secretValuesAllowed: false },
          deferred: true,
        },
        {
          provider: "vercel",
          status: "DISCONNECTED",
          displayName: null,
          secretsPolicy: { metadataAllowed: true, secretValuesAllowed: false },
          deferred: true,
        },
        {
          provider: "netlify",
          status: "DISCONNECTED",
          displayName: null,
          secretsPolicy: { metadataAllowed: true, secretValuesAllowed: false },
          deferred: true,
        },
        {
          provider: "render",
          status: "DISCONNECTED",
          displayName: null,
          secretsPolicy: { metadataAllowed: true, secretValuesAllowed: false },
          deferred: true,
        },
      ],
    };
  });
}
