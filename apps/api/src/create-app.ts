import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerEnv } from "@atlas/config";
import { createLogger } from "@atlas/observability";
import { isAllowedWebOrigin } from "./lib/web-origin.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerStateRoutes } from "./routes/state.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerPortfolioRoutes } from "./routes/portfolio.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerConversationRoutes } from "./routes/conversation.js";
import { registerEvalRoutes } from "./routes/eval.js";
import { registerGithubRoutes } from "./routes/github.js";
import { registerDbFeedRoutes } from "./routes/db-feeds.js";
import { registerDeployFeedRoutes } from "./routes/deploy-feeds.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerResearchRoutes } from "./routes/research.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerQaRoutes } from "./routes/qa.js";
import { registerExpertRoutes } from "./routes/experts.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConflictRoutes } from "./routes/conflicts.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerContactRoutes } from "./routes/contact.js";
import { registerAiProviderRoutes } from "./routes/ai-providers.js";
import { registerCodeRoutes } from "./routes/code.js";
import { registerGateRoutes } from "./routes/gates.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerProviderAdapterRoutes } from "./routes/provider-adapters.js";
import { registerEngineeringLoopRoutes } from "./routes/engineering-loop.js";
import { registerReadinessRoutes } from "./routes/readiness.js";
import { registerCommercialValidationRoutes } from "./routes/commercial.js";
import { registerByoCloudRoutes } from "./routes/byo-cloud.js";
import { registerAdminOpsRoutes } from "./routes/admin-ops.js";
import { registerAgentFabricRoutes } from "./routes/agent-fabric.js";
import { registerKernelRoutes } from "./routes/kernel.js";
import { registerEngineeringAuditRoutes } from "./routes/engineering-audit.js";
import { registerRemediationRoutes } from "./routes/remediation.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerLegalMediaRoutes } from "./routes/legal-media.js";
import { registerSecuritySarifRoutes } from "./routes/security-sarif.js";
import { registerEvalCiGateRoutes } from "./routes/eval-ci-gate.js";
import { registerObserverRoutes } from "./routes/observer.js";
import { registerSentinelRoutes } from "./routes/sentinel.js";
import { errorHandler } from "./middleware/error-handler.js";
import { osStore } from "./store/os-store.js";
import { hydrateOsStoreFromCloudIfEmpty } from "./services/store-hydrate.js";
import { ensureDevLocalPortfolioLink } from "./services/dev-local-bootstrap.js";

export async function buildApp(env: ServerEnv): Promise<FastifyInstance> {
  const logger = createLogger({
    service: "atlas-api",
    level: env.LOG_LEVEL,
  });

  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isAllowedWebOrigin(origin, env.WEB_ORIGIN));
    },
    credentials: true,
  });

  app.setErrorHandler(errorHandler);
  app.decorate("atlasEnv", env);
  app.decorate("atlasLogger", logger);

  osStore.ensureLoaded();
  const hydrate = await hydrateOsStoreFromCloudIfEmpty(env, {
    ownerId: env.ATLAS_OWNER_ID ?? null,
  });
  if (hydrate.attempted) {
    logger.info("store_cloud_hydrate", {
      hydrated: hydrate.hydrated,
      projects: hydrate.projects,
      memories: hydrate.memories,
      decisions: hydrate.decisions,
      plans: hydrate.plans,
      reason: hydrate.reason ?? null,
    });
  }

  const localBootstrap = ensureDevLocalPortfolioLink(env);
  logger.info("dev_local_portfolio_bootstrap", {
    connected: localBootstrap.connected,
    reposRoot: localBootstrap.reposRoot,
    scanned: localBootstrap.scanned,
    linked: localBootstrap.linked,
    goldenLinked: localBootstrap.goldenLinked,
    note: localBootstrap.note,
  });

  await registerHealthRoutes(app);
  await registerProjectRoutes(app);
  await registerStateRoutes(app);
  await registerMemoryRoutes(app);
  await registerDecisionRoutes(app);
  await registerEvidenceRoutes(app);
  await registerGraphRoutes(app);
  await registerPortfolioRoutes(app);
  await registerAgentRoutes(app);
  await registerConversationRoutes(app);
  await registerEvalRoutes(app);
  await registerEvalCiGateRoutes(app);
  await registerGithubRoutes(app);
  await registerDbFeedRoutes(app);
  await registerDeployFeedRoutes(app);
  // Deferred connectors / research — stubs only (Architecture v1.0 non-MVP)
  await registerKnowledgeRoutes(app);
  await registerResearchRoutes(app);
  await registerAuditRoutes(app);
  await registerIntegrationRoutes(app);
  await registerConnectionRoutes(app);
  await registerQaRoutes(app);
  await registerExpertRoutes(app);
  await registerBillingRoutes(app);
  await registerAuthRoutes(app);
  await registerConflictRoutes(app);
  await registerArtifactRoutes(app);
  await registerContactRoutes(app);
  await registerAiProviderRoutes(app);
  await registerCodeRoutes(app);
  await registerGateRoutes(app);
  await registerEventRoutes(app);
  await registerProviderAdapterRoutes(app);
  await registerSecuritySarifRoutes(app);
  await registerEngineeringLoopRoutes(app);
  await registerReadinessRoutes(app);
  await registerCommercialValidationRoutes(app);
  await registerByoCloudRoutes(app);
  await registerAdminOpsRoutes(app);
  await registerAgentFabricRoutes(app);
  await registerKernelRoutes(app);
  await registerEngineeringAuditRoutes(app);
  await registerRemediationRoutes(app);
  await registerMetricsRoutes(app);
  await registerLegalMediaRoutes(app);
  await registerObserverRoutes(app);
  await registerSentinelRoutes(app);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    atlasEnv: ServerEnv;
    atlasLogger: ReturnType<typeof createLogger>;
  }
}
