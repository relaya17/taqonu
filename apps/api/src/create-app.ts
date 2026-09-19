import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
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
import { registerPortfolioGovernanceRoutes } from "./routes/portfolio-governance.js";
import { registerSystemRoutes } from "./routes/systems.js";
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
import { registerStudioExecutionRoutes } from "./routes/studio-execution.js";
import { registerExemplarRoutes } from "./routes/exemplars.js";
import { registerGateRoutes } from "./routes/gates.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerProviderAdapterRoutes } from "./routes/provider-adapters.js";
import { registerEngineeringLoopRoutes } from "./routes/engineering-loop.js";
import { registerReadinessRoutes } from "./routes/readiness.js";
import { registerCommercialValidationRoutes } from "./routes/commercial.js";
import { registerByoCloudRoutes } from "./routes/byo-cloud.js";
import { registerAdminOpsRoutes } from "./routes/admin-ops.js";
import { registerPlatformSupervisionRoutes } from "./routes/platform-supervision.js";
import { registerAgentFabricRoutes } from "./routes/agent-fabric.js";
import { registerKernelRoutes } from "./routes/kernel.js";
import { registerEngineeringAuditRoutes } from "./routes/engineering-audit.js";
import { registerRemediationRoutes } from "./routes/remediation.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerLegalMediaRoutes } from "./routes/legal-media.js";
import { registerGatewayFulfillRoutes } from "./routes/gateway-fulfill.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerGovernedLifecycleHandoffRoutes } from "./routes/governed-lifecycle-handoff.js";
import { registerAgentRuntimeControlRoutes } from "./routes/agent-runtime-controls.js";
import { registerKillSwitchRoutes } from "./routes/kill-switches.js";
import { registerExecutionControlRoutes } from "./routes/executions-control.js";
import { registerErrorAggregateControlRoutes } from "./routes/error-aggregates-control.js";
import { registerPersonalSupervisingAgentRoutes } from "./routes/personal-supervising-agent.js";
import { registerSyntheticUniverseRoutes } from "./routes/synthetic-universe.js";
import { registerSecuritySarifRoutes } from "./routes/security-sarif.js";
import { registerEvalCiGateRoutes } from "./routes/eval-ci-gate.js";
import { registerObserverRoutes } from "./routes/observer.js";
import { registerSentinelRoutes } from "./routes/sentinel.js";
import { registerPerformanceRoutes } from "./routes/performance.js";
import { registerIntelligenceRoutes } from "./routes/intelligence.js";
import { registerCostIntelligenceRoutes } from "./routes/cost-intelligence.js";
import { registerApplicationPreflightRoutes } from "./routes/application-preflight.js";
import { errorHandler } from "./middleware/error-handler.js";
import { registerAtlasSessionGate } from "./middleware/atlas-session-gate.js";
import { registerRequestTiming } from "./middleware/request-timing.js";
import { osStore } from "./store/os-store.js";
import { hydrateOsStoreFromCloudIfEmpty } from "./services/store-hydrate.js";
import { registerEventRules } from "./services/event-rules.js";
import { registerControlPlaneBridge } from "./services/control-plane-bridge.js";
import { ensureDevLocalPortfolioLink } from "./services/dev-local-bootstrap.js";
import { ensureDevLocalUser } from "./services/auth-store.js";
import { registerFilesystemTools, registerAnalyzeRepoTool } from "@atlas/agent-core";
import { registerKnowledgeSearchTool } from "./services/knowledge-search-tool.js";
import {
  KNOWLEDGE_REFRESH_INTERVAL_MS,
  maybeRefreshVerifiedKnowledge,
} from "./services/verified-knowledge-refresh.js";

export async function buildApp(env: ServerEnv): Promise<FastifyInstance> {
  const logger = createLogger({
    service: "atlas-api",
    level: env.LOG_LEVEL,
  });

  const app = Fastify({
    logger: false,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isAllowedWebOrigin(origin, env.WEB_ORIGIN));
    },
    credentials: true,
    // @fastify/cors defaults Access-Control-Allow-Methods to "GET,HEAD,POST"
    // when this option is omitted -- it does NOT mirror the old `cors`
    // npm package's GET/HEAD/PUT/PATCH/POST/DELETE default. Left unset,
    // every PUT/PATCH/DELETE route (workspace-root link, project updates,
    // patch approve/apply/rollback, etc.) is silently CORS-blocked from the
    // deployed web app: the browser's preflight OPTIONS gets back an
    // Allow-Methods header that never included the method it asked for, so
    // the real request never leaves the browser. Confirmed live: PUT
    // /api/v1/projects/:id/workspace-root failed with "Disallowed Request
    // Method: PUT" even while authenticated and same-origin-approved.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  registerRequestTiming(app);

  app.setErrorHandler(errorHandler);
  app.decorate("atlasEnv", env);
  app.decorate("atlasLogger", logger);
  registerKnowledgeSearchTool(env);
  registerFilesystemTools();
  registerAnalyzeRepoTool();

  registerAtlasSessionGate(app);

  registerEventRules();
  registerControlPlaneBridge();

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

  const devUser = ensureDevLocalUser();
  if (devUser) {
    logger.info("dev_local_user_ready", {
      email: devUser.email,
      created: devUser.created,
      note: "Development login identity is available for the local owner account",
    });
  }

  await registerHealthRoutes(app);
  await registerProjectRoutes(app);
  await registerStateRoutes(app);
  await registerMemoryRoutes(app);
  await registerDecisionRoutes(app);
  await registerEvidenceRoutes(app);
  await registerGraphRoutes(app);
  await registerPortfolioRoutes(app);
  await registerPortfolioGovernanceRoutes(app);
  await registerSystemRoutes(app);
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
  await registerStudioExecutionRoutes(app);
  await registerExemplarRoutes(app);
  await registerGateRoutes(app);
  await registerEventRoutes(app);
  await registerProviderAdapterRoutes(app);
  await registerSecuritySarifRoutes(app);
  await registerEngineeringLoopRoutes(app);
  await registerReadinessRoutes(app);
  await registerCommercialValidationRoutes(app);
  await registerByoCloudRoutes(app);
  await registerAdminOpsRoutes(app);
  await registerPlatformSupervisionRoutes(app);
  await registerAgentFabricRoutes(app);
  await registerKernelRoutes(app);
  await registerEngineeringAuditRoutes(app);
  await registerRemediationRoutes(app);
  await registerMetricsRoutes(app);
  await registerLegalMediaRoutes(app);
  await registerGatewayFulfillRoutes(app);
  await registerApprovalRoutes(app);
  await registerGovernedLifecycleHandoffRoutes(app);
  await registerAgentRuntimeControlRoutes(app);
  await registerKillSwitchRoutes(app);
  await registerExecutionControlRoutes(app);
  await registerErrorAggregateControlRoutes(app);
  await registerPersonalSupervisingAgentRoutes(app);
  await registerSyntheticUniverseRoutes(app);
  await registerObserverRoutes(app);
  await registerSentinelRoutes(app);
  await registerPerformanceRoutes(app);
  await registerIntelligenceRoutes(app);
  await registerCostIntelligenceRoutes(app);
  await registerApplicationPreflightRoutes(app);

  void maybeRefreshVerifiedKnowledge({ env }).catch((err) => {
    logger.warn("knowledge_refresh_boot_failed", {
      message: err instanceof Error ? err.message : "refresh failed",
    });
  });
  if (!process.env.VERCEL) {
    const timer = setInterval(() => {
      void maybeRefreshVerifiedKnowledge({ env }).catch((err) => {
        logger.warn("knowledge_refresh_daily_failed", {
          message: err instanceof Error ? err.message : "refresh failed",
        });
      });
    }, KNOWLEDGE_REFRESH_INTERVAL_MS);
    timer.unref?.();
    app.addHook("onClose", async () => {
      clearInterval(timer);
    });
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    atlasEnv: ServerEnv;
    atlasLogger: ReturnType<typeof createLogger>;
  }
}
